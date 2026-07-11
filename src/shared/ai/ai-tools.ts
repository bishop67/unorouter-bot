import { tool } from "ai";
import { z } from "zod/v4";
import { and, count, desc, eq, gte } from "drizzle-orm";
import dayjs from "dayjs";
import { logger } from "@/lib/logger";
import { ConfigValidator } from "@/shared/config/validator";
import { db } from "@/lib/db";
import { memberMessages } from "@/lib/db-schema";
import { LEVEL_LIST } from "@/shared/config/levels";
import { STAFF_ROLES } from "@/shared/config/roles";
import { bot } from "@/main";

function levelForCount(messageCount: number): string | null {
  const tier = [...LEVEL_LIST].reverse().find((l) => messageCount >= l.count);
  return tier?.role ?? null;
}

const KLIPY_API_KEY = process.env.KLIPY_API_KEY;
const KLIPY_BASE_URL = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}/gifs/search`;
const KLIPY_CUSTOMER_ID = process.env.BOT_NAME?.trim() || "unorouter-bot";

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

    const response = await fetch(`${KLIPY_BASE_URL}?${params}`);

    if (!response.ok) {
      throw new Error(`Klipy API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: boolean;
      data?: { data?: Array<{ file?: { md?: { gif?: { url?: string } } } }> };
    };

    return (
      data.data?.data
        ?.map((result: any) => result.file?.md?.gif?.url)
        .filter(Boolean) || []
    );
  } catch (error) {
    logger.error("Error fetching GIFs", { error: String(error) });
    return [];
  }
}

const gatherChannelContext = tool({
  description:
    "Read recent human messages from a channel to get more conversation context before answering. Bot messages (including your own) are excluded automatically. Pass the current channel's ID to catch up on what's being discussed.",
  inputSchema: z.object({
    channelId: z
      .string()
      .describe("The Discord channel ID to fetch messages from"),
    guildId: z.string().describe("The Discord guild/server ID"),
    messageCount: z
      .number()
      .min(1)
      .max(100)
      .default(25)
      .describe("Number of recent human messages to return (1-100)"),
  }),
  execute: async ({ channelId, guildId, messageCount }) => {
    try {
      logger.info("Gathering AI context", { channelId, guildId });
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return { success: false, error: "Guild not found" };
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return { success: false, error: "Channel not found or not text-based" };
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
      logger.error("Error gathering channel context", { error: String(error) });
      return {
        success: false,
        error: `Failed to gather channel context: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

const getServerExpressions = tool({
  description:
    "List the custom emojis and stickers available in this Discord server. Call this before using any emoji or sticker so you use real IDs. To use an emoji, paste its `tag` value verbatim inline in your reply text. To send a sticker, pass its `id` to sendServerSticker.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild/server ID"),
  }),
  execute: async ({ guildId }: { guildId: string }) => {
    try {
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return { success: false, error: "Guild not found" };
      }

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

const sendServerSticker = tool({
  description:
    "Send one of this server's custom stickers with your reply. Get valid sticker IDs from getServerExpressions first. One sticker per reply.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild/server ID"),
    stickerId: z
      .string()
      .describe("The sticker ID from getServerExpressions to send"),
  }),
  execute: async ({
    guildId,
    stickerId,
  }: {
    guildId: string;
    stickerId: string;
  }) => {
    try {
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return { success: false, error: "Guild not found" };
      }
      const stickers = await guild.stickers.fetch().catch(() => null);
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
    "Search for and send a meme GIF to enhance your response with visual humor.",
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
        const response = await fetch(gif, { method: "HEAD" });
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

const getServerStats = tool({
  description:
    "Get overall stats about this Discord server: member count, online count, boost level/count, how many messages are tracked, and the top channels and members by activity. Use for 'how big is the server', 'how active are we', 'top channels' type questions.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild/server ID"),
    lookbackDays: z
      .number()
      .min(1)
      .max(9999)
      .default(9999)
      .describe("Only count messages from the past N days (default: all time)"),
  }),
  execute: async ({
    guildId,
    lookbackDays,
  }: {
    guildId: string;
    lookbackDays: number;
  }) => {
    try {
      const guild = await bot.guilds
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
          .limit(5),
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
        window: lookbackDays >= 9999 ? "all time" : `past ${lookbackDays} days`,
        topChannels: topChannels
          .filter((c) => guild.channels.cache.has(c.channelId))
          .map((c) => ({
            channel: guild.channels.cache.get(c.channelId)?.name ?? c.channelId,
            messages: c.count,
          })),
        topMembers: namedMembers.filter(Boolean),
      };
    } catch (error) {
      logger.error("Error getting server stats", { error: String(error) });
      return { success: false, error: "Failed to get server stats" };
    }
  },
});

const getStaffAndHelpers = tool({
  description:
    "List the server's staff/admins and its most-active members (top helpers by message count). Use when someone asks who runs the server, who to contact, who the mods are, or who the most active people are.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild/server ID"),
  }),
  execute: async ({ guildId }: { guildId: string }) => {
    try {
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) return { success: false, error: "Guild not found" };

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
        .where(eq(memberMessages.guildId, guildId))
        .groupBy(memberMessages.memberId)
        .orderBy(desc(count()))
        .limit(8);

      const helpers = (
        await Promise.all(
          topActive.map(async (row) => {
            const m = await guild.members.fetch(row.memberId).catch(() => null);
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

const lookupUserActivity = tool({
  description:
    "Look up a specific member's activity: their tracked message count, current level/rank, roles, join date, and booster status. Pass the numeric user ID (from a mention like <@123>, strip the <@ >). Use for 'how active is X', 'what level is X', 'when did X join'.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild/server ID"),
    userId: z.string().describe("The numeric Discord user ID to look up"),
  }),
  execute: async ({
    guildId,
    userId,
  }: {
    guildId: string;
    userId: string;
  }) => {
    try {
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) return { success: false, error: "Guild not found" };

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return { success: false, error: "Member not found" };

      const [row] = await db
        .select({ count: count() })
        .from(memberMessages)
        .where(
          and(
            eq(memberMessages.memberId, userId),
            eq(memberMessages.guildId, guildId),
          ),
        );
      const messageCount = row?.count ?? 0;

      return {
        success: true,
        name: member.displayName,
        isBot: member.user.bot,
        messageCount,
        level: levelForCount(messageCount),
        isStaff: member.roles.cache.some((r) => STAFF_ROLES.includes(r.name)),
        isBooster: !!member.premiumSince,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        roles: member.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => r.name),
      };
    } catch (error) {
      logger.error("Error looking up user activity", { error: String(error) });
      return { success: false, error: "Failed to look up user" };
    }
  },
});

export const AI_TOOLS = {
  searchMemeGifs,
  gatherChannelContext,
  getServerExpressions,
  sendServerSticker,
  getServerStats,
  getStaffAndHelpers,
  lookupUserActivity,
};
