import { tool } from "ai";
import { z } from "zod/v4";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import dayjs from "dayjs";
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
} from "discord.js";
import { logger } from "@/lib/logger";
import { ConfigValidator } from "@/shared/config/validator";
import { db } from "@/lib/db";
import {
  bugReport,
  giveawayWinner,
  inviteJoin,
  memberMessages,
  rewardGrant,
  serverTagWear,
  ticket,
} from "@/lib/db-schema";
import { QUOTA_PER_DOLLAR } from "@/shared/config/rewards";
import { LEVEL_LIST } from "@/shared/config/levels";
import { STAFF_ROLES } from "@/shared/config/roles";

// Never from model arguments: a prompt must not reach another guild or member's view.
type ToolScope = { guild: Guild; member: GuildMember };

const READ_CHANNEL = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

function isModerator(member: GuildMember): boolean {
  return member.permissions.any([
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ModerateMembers,
  ]);
}

function levelForCount(messageCount: number): string | null {
  const tier = [...LEVEL_LIST].reverse().find((l) => messageCount >= l.count);
  return tier?.role ?? null;
}

const KLIPY_API_KEY = process.env.KLIPY_API_KEY;
const KLIPY_BASE_URL = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}/gifs/search`;
const KLIPY_CUSTOMER_ID = process.env.BOT_NAME?.trim() || "unorouter-bot";

function isKlipyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "klipy.com" || host.endsWith(".klipy.com"))
    );
  } catch {
    return false;
  }
}

async function searchGifs(query: string, limit: number = 5): Promise<string[]> {
  if (!KLIPY_API_KEY) {
    logger.warn("KLIPY_API_KEY not configured - GIF search disabled");
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query,
      per_page: limit.toString(),
      content_filter: "off",
      format_filter: "gif",
      customer_id: KLIPY_CUSTOMER_ID,
    });

    const response = await fetch(`${KLIPY_BASE_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Klipy API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: boolean;
      data?: { data?: Array<{ file?: { md?: { gif?: { url?: string } } } }> };
    };

    return (
      data.data?.data
        ?.map((result) => result.file?.md?.gif?.url)
        .filter((url): url is string => !!url && isKlipyUrl(url)) ?? []
    );
  } catch (error) {
    logger.error("Error fetching GIFs", { error: String(error) });
    return [];
  }
}

const gatherChannelContext = (scope: ToolScope) =>
  tool({
    description:
      "Read recent human messages from a channel in this server to get more conversation context before answering. Bot messages (including your own) are excluded automatically. Pass the current channel's ID to catch up on what's being discussed. Only channels the asking user can read themselves are allowed; a refusal means they lack access, so do not describe that channel.",
    inputSchema: z.object({
      channelId: z
        .string()
        .describe("The Discord channel ID to fetch messages from"),
      messageCount: z
        .number()
        .min(1)
        .max(100)
        .default(25)
        .describe("Number of recent human messages to return (1-100)"),
    }),
    execute: async ({ channelId, messageCount }) => {
      try {
        logger.info("Gathering AI context", {
          channelId,
          guildId: scope.guild.id,
          requesterId: scope.member.id,
        });
        const channel = await scope.guild.channels
          .fetch(channelId)
          .catch(() => null);
        if (!channel || !channel.isTextBased()) {
          return {
            success: false,
            error: "Channel not found or not text-based",
          };
        }

        const perms = channel.permissionsFor(scope.member);
        const canRead = perms?.has(READ_CHANNEL) ?? false;
        // A private thread hides from members who can read its parent.
        const threadAccess =
          channel.type !== ChannelType.PrivateThread ||
          !!perms?.has(PermissionFlagsBits.ManageThreads) ||
          !!(await channel.members.fetch(scope.member.id).catch(() => null));
        if (!canRead || !threadAccess) {
          return {
            success: false,
            error:
              "The asking user cannot read that channel. Refuse and do not reveal anything about it.",
          };
        }

        // Over-fetch so bot messages filtered out below don't shrink the result
        // below the requested count.
        const fetchLimit = Math.min(messageCount * 2, 100);
        const messages = await channel.messages.fetch({ limit: fetchLimit });
        const sortedMessages = Array.from(messages.values())
          .filter((msg) => !msg.author.bot)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .slice(-messageCount);

        const messageContexts = sortedMessages.map((message) => ({
          timestamp: message.createdAt.toISOString(),
          author: {
            id: message.author.id,
            username: message.author.username,
            displayName: message.author.globalName,
          },
          content: message.content,
          hasAttachments: message.attachments.size > 0,
          isReply: !!message.reference,
          replyToId: message.reference?.messageId,
        }));

        return {
          success: true,
          context: {
            messageCount: messageContexts.length,
            messages: messageContexts,
            fetchedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        logger.error("Error gathering channel context", {
          error: String(error),
        });
        return {
          success: false,
          error: `Failed to gather channel context: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });

const getServerExpressions = (scope: ToolScope) =>
  tool({
    description:
      "List the custom emojis and stickers available in this Discord server. Call this before using any emoji or sticker so you use real IDs. To use an emoji, paste its `tag` value verbatim inline in your reply text. To send a sticker, pass its `id` to sendServerSticker.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const guild = scope.guild;
        const emojis = await guild.emojis.fetch().catch(() => null);
        const stickers = await guild.stickers.fetch().catch(() => null);

        return {
          success: true,
          emojis: emojis
            ? Array.from(emojis.values()).map((emoji) => ({
                name: emoji.name,
                tag: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
              }))
            : [],
          stickers: stickers
            ? Array.from(stickers.values()).map((sticker) => ({
                name: sticker.name,
                id: sticker.id,
                description: sticker.description,
              }))
            : [],
        };
      } catch (error) {
        logger.error("Error fetching server expressions", {
          error: String(error),
        });
        return { success: false, error: "Failed to fetch server expressions" };
      }
    },
  });

const sendServerSticker = (scope: ToolScope) =>
  tool({
    description:
      "Send one of this server's custom stickers with your reply. Get valid sticker IDs from getServerExpressions first. One sticker per reply.",
    inputSchema: z.object({
      stickerId: z
        .string()
        .describe("The sticker ID from getServerExpressions to send"),
    }),
    execute: async ({ stickerId }: { stickerId: string }) => {
      try {
        const stickers = await scope.guild.stickers.fetch().catch(() => null);
        if (!stickers?.has(stickerId)) {
          return { success: false, error: "Sticker not found in this server" };
        }
        return { success: true, stickerId };
      } catch (error) {
        logger.error("Error sending server sticker", { error: String(error) });
        return { success: false, error: "Failed to send sticker" };
      }
    },
  });

const searchMemeGifs = tool({
  description:
    "Search Klipy for a meme GIF and attach it to this reply. This is the only way a GIF can reach the user: a GIF URL typed into the reply text is stripped before sending. Use it rarely, for a moment that genuinely lands (a celebration, an epic fail, or when asked); custom server emojis are the default flavor. The GIF accompanies a text answer, never replaces it, and a reply carries at most one of GIF or sticker. Returns { success, gifUrl } or { success: false, error }.",
  inputSchema: z.object({
    query: z.string().describe("Search query for the GIF"),
  }),
  execute: async ({ query }: { query: string }) => {
    if (!ConfigValidator.isFeatureEnabled("KLIPY_API_KEY")) {
      return { success: false, error: "GIF search not available" };
    }

    const gifs = await searchGifs(query, 10);
    for (const gif of gifs) {
      try {
        const response = await fetch(gif, {
          method: "HEAD",
          signal: AbortSignal.timeout(5_000),
        });
        if (!isKlipyUrl(response.url)) continue;
        const size = parseInt(response.headers.get("content-length") ?? "0");
        if (size && size < 8 * 1024 * 1024) {
          return { success: true, gifUrl: gif };
        }
      } catch {
        continue;
      }
    }
    return { success: false, error: "No suitable GIF found" };
  },
});

const getServerStats = (scope: ToolScope) =>
  tool({
    description:
      "Get overall stats about this Discord server: member count, online count, boost level/count, how many messages are tracked, and the top channels and members by activity. Use for 'how big is the server', 'how active are we', 'top channels' type questions.",
    inputSchema: z.object({
      lookbackDays: z
        .number()
        .min(1)
        .max(9999)
        .default(9999)
        .describe(
          "Only count messages from the past N days (default: all time)",
        ),
    }),
    execute: async ({ lookbackDays }: { lookbackDays: number }) => {
      try {
        const guildId = scope.guild.id;
        const guild = await scope.guild.client.guilds
          .fetch({ guild: guildId, withCounts: true })
          .catch(() => null);
        if (!guild) return { success: false, error: "Guild not found" };

        const since = dayjs().subtract(lookbackDays, "day").toISOString();
        const filters = and(
          eq(memberMessages.guildId, guildId),
          gte(memberMessages.createdAt, since),
        );

        const [[totals], topChannels, topMembers] = await Promise.all([
          db.select({ total: count() }).from(memberMessages).where(filters),
          db
            .select({ channelId: memberMessages.channelId, count: count() })
            .from(memberMessages)
            .where(filters)
            .groupBy(memberMessages.channelId)
            .orderBy(desc(count()))
            .limit(25),
          db
            .select({ memberId: memberMessages.memberId, count: count() })
            .from(memberMessages)
            .where(filters)
            .groupBy(memberMessages.memberId)
            .orderBy(desc(count()))
            .limit(5),
        ]);

        const namedMembers = await Promise.all(
          topMembers.map(async (row) => {
            const m = await guild.members.fetch(row.memberId).catch(() => null);
            return m && !m.user.bot
              ? { name: m.displayName, messages: row.count }
              : null;
          }),
        );

        return {
          success: true,
          name: guild.name,
          memberCount: guild.memberCount,
          onlineCount: guild.approximatePresenceCount ?? null,
          boostCount: guild.premiumSubscriptionCount ?? 0,
          boostTier: guild.premiumTier,
          messagesTracked: totals?.total ?? 0,
          window:
            lookbackDays >= 9999 ? "all time" : `past ${lookbackDays} days`,
          topChannels: topChannels
            .flatMap((c) => {
              const channel = guild.channels.cache.get(c.channelId);
              return channel?.permissionsFor(scope.member).has(READ_CHANNEL)
                ? [{ channel: channel.name, messages: c.count }]
                : [];
            })
            .slice(0, 5),
          topMembers: namedMembers.filter(Boolean),
        };
      } catch (error) {
        logger.error("Error getting server stats", { error: String(error) });
        return { success: false, error: "Failed to get server stats" };
      }
    },
  });

const getStaffAndHelpers = (scope: ToolScope) =>
  tool({
    description:
      "List the server's staff/admins and its most-active members (top helpers by message count). Use when someone asks who runs the server, who to contact, who the mods are, or who the most active people are.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const guild = scope.guild;
        await guild.members.fetch().catch(() => null);

        const staff = guild.members.cache
          .filter(
            (m) =>
              !m.user.bot &&
              m.roles.cache.some((r) => STAFF_ROLES.includes(r.name)),
          )
          .map((m) => ({
            name: m.displayName,
            roles: m.roles.cache
              .filter((r) => STAFF_ROLES.includes(r.name))
              .map((r) => r.name),
          }));

        const topActive = await db
          .select({ memberId: memberMessages.memberId, count: count() })
          .from(memberMessages)
          .where(eq(memberMessages.guildId, guild.id))
          .groupBy(memberMessages.memberId)
          .orderBy(desc(count()))
          .limit(8);

        const helpers = (
          await Promise.all(
            topActive.map(async (row) => {
              const m = await guild.members
                .fetch(row.memberId)
                .catch(() => null);
              return m && !m.user.bot
                ? { name: m.displayName, messages: row.count }
                : null;
            }),
          )
        )
          .filter(Boolean)
          .slice(0, 5);

        return { success: true, staff, topActiveMembers: helpers };
      } catch (error) {
        logger.error("Error getting staff/helpers", { error: String(error) });
        return { success: false, error: "Failed to get staff and helpers" };
      }
    },
  });

const lookupUserActivity = (scope: ToolScope) =>
  tool({
    description:
      "Full stats for one member: message count, channels posted in, first and last message, level/rank, roles, join date, booster and server-tag status, rewards earned and balance earned, members invited, giveaway wins, tickets opened, bugs reported. Pass the numeric user ID (from a mention like <@123>, strip the <@ >), or omit it when the asker asks about themselves. Use for 'how active is X', 'what level is X', 'when did X join', 'how long have I been here', 'my stats'. None of this is private; it is already visible in Discord, so answer rather than declining. The one exception is balance earned: it is returned only when the asker looks up themselves or is a moderator, so when it is missing give the activity stats without the money.",
    inputSchema: z.object({
      userId: z
        .string()
        .optional()
        .describe("The numeric Discord user ID to look up; omit for the asker"),
    }),
    execute: async (input: { userId?: string }) => {
      try {
        const userId = input.userId ?? scope.member.id;
        const guildId = scope.guild.id;
        const member = await scope.guild.members
          .fetch(userId)
          .catch(() => null);
        if (!member) return { success: false, error: "Member not found" };

        // One round trip: nine separate counts would be nine queries per question.
        const stats = await db.execute<{
          msgs: number;
          channels: number;
          first_msg: string | null;
          last_msg: string | null;
          grants: number;
          quota: number;
          invited: number;
          giveaway_wins: number;
          tickets: number;
          bugs: number;
          wearing_tag: number;
        }>(sql`
        SELECT
          (SELECT count(*) FROM ${memberMessages}
             WHERE member_id = ${userId} AND guild_id = ${guildId})::int AS msgs,
          (SELECT count(DISTINCT channel_id) FROM ${memberMessages}
             WHERE member_id = ${userId} AND guild_id = ${guildId})::int AS channels,
          (SELECT min(created_at) FROM ${memberMessages}
             WHERE member_id = ${userId} AND guild_id = ${guildId}) AS first_msg,
          (SELECT max(created_at) FROM ${memberMessages}
             WHERE member_id = ${userId} AND guild_id = ${guildId}) AS last_msg,
          (SELECT count(*) FROM ${rewardGrant}
             WHERE target_member_id = ${userId})::int AS grants,
          (SELECT coalesce(sum(quota), 0) FROM ${rewardGrant}
             WHERE target_member_id = ${userId})::int AS quota,
          (SELECT count(*) FROM ${inviteJoin}
             WHERE inviter_id = ${userId})::int AS invited,
          (SELECT count(*) FROM ${giveawayWinner}
             WHERE member_id = ${userId})::int AS giveaway_wins,
          (SELECT count(*) FROM ${ticket}
             WHERE opener_id = ${userId})::int AS tickets,
          (SELECT count(*) FROM ${bugReport}
             WHERE reporter_id = ${userId})::int AS bugs,
          (SELECT count(*) FROM ${serverTagWear}
             WHERE member_id = ${userId} AND active)::int AS wearing_tag
      `);
        const s = stats[0];
        const messageCount = s?.msgs ?? 0;

        return {
          success: true,
          name: member.displayName,
          isBot: member.user.bot,
          messageCount,
          level: levelForCount(messageCount),
          isStaff: member.roles.cache.some((r) => STAFF_ROLES.includes(r.name)),
          isBooster: !!member.premiumSince,
          joinedAt: member.joinedAt?.toISOString() ?? null,
          channelsPostedIn: s?.channels ?? 0,
          firstMessageAt: s?.first_msg ?? null,
          lastMessageAt: s?.last_msg ?? null,
          rewardsEarned: s?.grants ?? 0,
          balanceEarnedUsd:
            userId === scope.member.id || isModerator(scope.member)
              ? QUOTA_PER_DOLLAR > 0
                ? (s?.quota ?? 0) / QUOTA_PER_DOLLAR
                : 0
              : undefined,
          membersInvited: s?.invited ?? 0,
          giveawayWins: s?.giveaway_wins ?? 0,
          ticketsOpened: s?.tickets ?? 0,
          bugsReported: s?.bugs ?? 0,
          wearingServerTag: (s?.wearing_tag ?? 0) > 0,
          roles: member.roles.cache
            .filter((r) => r.name !== "@everyone")
            .map((r) => r.name),
        };
      } catch (error) {
        logger.error("Error looking up user activity", {
          error: String(error),
        });
        return { success: false, error: "Failed to look up user" };
      }
    },
  });

export function createAiTools(scope: ToolScope) {
  return {
    searchMemeGifs,
    gatherChannelContext: gatherChannelContext(scope),
    getServerExpressions: getServerExpressions(scope),
    sendServerSticker: sendServerSticker(scope),
    getServerStats: getServerStats(scope),
    getStaffAndHelpers: getStaffAndHelpers(scope),
    lookupUserActivity: lookupUserActivity(scope),
  };
}
