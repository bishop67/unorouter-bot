import { db } from "@/lib/db";
import {
  channel as channelTable,
  rewardClaim,
  ticket,
  ticketMessage,
} from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { STAFF_ROLES } from "@/shared/config/roles";
import { findCategory, findTextChannel } from "@/shared/utils/channel.utils";
import { ButtonId, ButtonIdBuilder } from "@/types/custom-ids";
import { and, eq, sql } from "drizzle-orm";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  OverwriteType,
  PermissionFlagsBits,
  type TextChannel,
} from "discord.js";

// Channels resolved by NAME (substring), not id, so emoji renames don't break config.
const TICKET_CATEGORY_NAME = process.env.TICKET_CATEGORY?.trim() || "tickets";
const TICKET_LOG_CHANNEL_NAME =
  process.env.TICKET_LOG_CHANNEL?.trim() || "ticket-logs";

export const TicketCategory = {
  Support: "support",
  Bug: "bug",
} as const;
export type TicketCategory =
  (typeof TicketCategory)[keyof typeof TicketCategory];

export const TicketStatus = {
  Open: "open",
  Closed: "closed",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketOpenStatus = {
  Ok: "ok",
  AlreadyOpen: "already_open",
  NoCategory: "no_category",
  Error: "error",
} as const;
export type TicketOpenStatus =
  (typeof TicketOpenStatus)[keyof typeof TicketOpenStatus];

export type TicketOpenResult =
  | { status: typeof TicketOpenStatus.Ok; channel: TextChannel }
  | { status: typeof TicketOpenStatus.AlreadyOpen; channelId: string }
  | { status: typeof TicketOpenStatus.NoCategory }
  | { status: typeof TicketOpenStatus.Error; error: string };

export class TicketService {
  static buildControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonId.TicketReward)
        .setLabel("Approve & Reward")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(ButtonId.TicketClose)
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger),
    );
  }

  /**
   * Create a private ticket channel under the TICKETS category, visible only to the
   * opener + staff roles (and the bot). Returns the channel or null on failure.
   */
  static async open(
    guild: Guild,
    opener: GuildMember,
    category: TicketCategory,
  ): Promise<TicketOpenResult> {
    // One-ticket-per-user guard: refuse if the opener already has an open ticket
    // in this guild.
    const existing = await db.query.ticket.findFirst({
      where: and(
        eq(ticket.guildId, guild.id),
        eq(ticket.openerId, opener.id),
        eq(ticket.status, TicketStatus.Open),
      ),
    });
    if (existing) {
      return {
        status: TicketOpenStatus.AlreadyOpen,
        channelId: existing.channelId,
      };
    }

    const ticketsCategory = findCategory(guild, TICKET_CATEGORY_NAME);
    if (!ticketsCategory) {
      logger.error("Ticket open failed: TICKETS category not found", {
        name: TICKET_CATEGORY_NAME,
      });
      return { status: TicketOpenStatus.NoCategory };
    }

    const staffRoleIds = STAFF_ROLES.map(
      (name) => guild.roles.cache.find((r) => r.name === name)?.id,
    ).filter((id): id is string => Boolean(id));

    // Bot's own member must be allowed to view + manage the new channel;
    // without an explicit allow the @everyone deny below wins for the bot too,
    // and the post-create channel.send returns 50001 Missing Access.
    const botMemberId = guild.members.me?.id;

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: PermissionFlagsBits.ViewChannel,
      },
      ...(botMemberId
        ? [
            {
              id: botMemberId,
              type: OverwriteType.Member,
              allow:
                PermissionFlagsBits.ViewChannel |
                PermissionFlagsBits.SendMessages |
                PermissionFlagsBits.ReadMessageHistory |
                PermissionFlagsBits.EmbedLinks |
                PermissionFlagsBits.AttachFiles,
            },
          ]
        : []),
      {
        id: opener.id,
        type: OverwriteType.Member,
        allow:
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.ReadMessageHistory |
          PermissionFlagsBits.AttachFiles,
      },
      ...staffRoleIds.map((id) => ({
        id,
        type: OverwriteType.Role,
        allow:
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.ReadMessageHistory |
          PermissionFlagsBits.AttachFiles,
      })),
    ];

    let channel: TextChannel;
    try {
      channel = await guild.channels.create({
        name: `${category}-${opener.user.username}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: ticketsCategory.id,
        permissionOverwrites: overwrites,
        reason: `Ticket opened by ${opener.user.tag}`,
      });
    } catch (err) {
      logger.error("Ticket channel create failed", { error: String(err) });
      return { status: TicketOpenStatus.Error, error: String(err) };
    }

    // Channel entity is the FK parent for the ticket row.
    await db
      .insert(channelTable)
      .values({ channelId: channel.id, guildId: guild.id, name: channel.name })
      .onConflictDoUpdate({
        target: channelTable.channelId,
        set: { name: sql`excluded.name`, updatedAt: sql`CURRENT_TIMESTAMP` },
      });

    await db.insert(ticket).values({
      guildId: guild.id,
      channelId: channel.id,
      openerId: opener.id,
      category,
    });

    const staffPing = staffRoleIds.map((id) => `<@&${id}>`).join(" ");
    await channel.send({
      content: `${opener} opened a **${category}** ticket. ${staffPing}`.trim(),
      components: [this.buildControls()],
      allowedMentions: { users: [opener.id], roles: staffRoleIds },
    });

    return { status: TicketOpenStatus.Ok, channel };
  }

  static async logTicketMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guild) return;

    const row = await this.getOpenTicket(message.channel.id);
    if (!row) return;

    await db
      .insert(ticketMessage)
      .values({
        ticketId: row.id,
        authorId: message.author.id,
        content: message.content || "(no text content)",
      })
      .catch(() => {});
  }

  static buildRedeemButton(ticketId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonIdBuilder.ticketRedeem(ticketId))
        .setLabel("Redeem reward")
        .setEmoji("🎁")
        .setStyle(ButtonStyle.Success),
    );
  }

  static async getById(ticketId: number) {
    return db.query.ticket.findFirst({ where: eq(ticket.id, ticketId) });
  }

  static async getTicketClaim(ticketId: number) {
    return db.query.rewardClaim.findFirst({
      where: and(
        eq(rewardClaim.sourceType, "ticket"),
        eq(rewardClaim.refId, String(ticketId)),
      ),
    });
  }

  static async setPendingReward(args: {
    ticketId: number;
    guildId: string;
    targetId: string;
    quota: number;
    reason: string;
    grantedBy: string;
  }): Promise<void> {
    const grantedByMemberId =
      args.grantedBy === "system" ? null : args.grantedBy;
    await db
      .insert(rewardClaim)
      .values({
        sourceType: "ticket",
        guildId: args.guildId,
        targetMemberId: args.targetId,
        refId: String(args.ticketId),
        status: "pending",
        pendingQuota: args.quota,
        pendingReason: args.reason,
        grantedByMemberId,
      })
      .onConflictDoUpdate({
        target: [
          rewardClaim.sourceType,
          rewardClaim.guildId,
          rewardClaim.targetMemberId,
          rewardClaim.refId,
        ],
        set: {
          status: "pending",
          pendingQuota: args.quota,
          pendingReason: args.reason,
          grantedByMemberId,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  static async markRedeemed(
    ticketId: number,
    rewardedQuota: number,
  ): Promise<void> {
    await db
      .update(rewardClaim)
      .set({
        status: "paid",
        rewardedQuota,
        rewardedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(rewardClaim.sourceType, "ticket"),
          eq(rewardClaim.refId, String(ticketId)),
        ),
      );
  }

  static async close(channel: GuildTextBasedChannel): Promise<boolean> {
    const row = await this.getOpenTicket(channel.id);
    if (!row) return false;

    await db
      .update(ticket)
      .set({ status: TicketStatus.Closed, closedAt: new Date().toISOString() })
      .where(eq(ticket.id, row.id));

    const transcript = await this.buildTranscript(
      row.id,
      channel.name,
      channel.client,
    );
    const logChannel = findTextChannel(channel.guild, TICKET_LOG_CHANNEL_NAME);
    if (logChannel) {
      await logChannel.send({
        content: `Ticket #${row.id} (${row.category}) closed - opener <@${row.openerId}>`,
        files: [transcript],
        allowedMentions: { users: [] },
      });
    }

    await channel.delete(`Ticket #${row.id} closed`).catch(() => {});
    return true;
  }

  static async getOpenTicket(channelId: string) {
    return db.query.ticket.findFirst({
      where: and(
        eq(ticket.channelId, channelId),
        eq(ticket.status, TicketStatus.Open),
      ),
    });
  }

  /**
   * Close every open ticket a member opened. Used when a member is jailed so
   * their support channels don't linger. Each ticket is closed via close()
   * (transcript + log + channel delete); a ticket whose channel is already gone
   * is marked closed in the DB so it can't be reopened as a duplicate.
   */
  static async closeAllForOpener(
    guild: Guild,
    openerId: string,
  ): Promise<number> {
    const rows = await db.query.ticket.findMany({
      where: and(
        eq(ticket.openerId, openerId),
        eq(ticket.status, TicketStatus.Open),
      ),
    });

    let closed = 0;
    for (const row of rows) {
      const channel = guild.channels.cache.get(row.channelId) as
        | GuildTextBasedChannel
        | undefined;
      if (channel) {
        if (await this.close(channel)) closed++;
        continue;
      }
      // Channel is gone but the row is still open: settle the DB so it isn't
      // treated as an active ticket.
      await db
        .update(ticket)
        .set({
          status: TicketStatus.Closed,
          closedAt: new Date().toISOString(),
        })
        .where(eq(ticket.id, row.id));
      closed++;
    }
    return closed;
  }

  private static async buildTranscript(
    ticketId: number,
    channelName: string,
    client: Client,
  ): Promise<AttachmentBuilder> {
    const messages = await db.query.ticketMessage.findMany({
      where: eq(ticketMessage.ticketId, ticketId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    // authorTag is no longer stored; resolve the tag from the author id at read.
    const tagCache = new Map<string, string>();
    const resolveAuthor = async (authorId: string | null): Promise<string> => {
      if (!authorId) return "Unknown";
      const cached = tagCache.get(authorId);
      if (cached) return cached;
      const user =
        client.users.cache.get(authorId) ??
        (await client.users.fetch(authorId).catch(() => null));
      const tag = user?.tag ?? authorId;
      tagCache.set(authorId, tag);
      return tag;
    };

    const lines = await Promise.all(
      messages.map(
        async (m) =>
          `[${m.createdAt}] ${await resolveAuthor(m.authorId)}: ${m.content}`,
      ),
    );
    const body = `Transcript for ticket #${ticketId} (${channelName})\n\n${lines.join("\n")}\n`;
    return new AttachmentBuilder(Buffer.from(body, "utf-8"), {
      name: `ticket-${ticketId}.txt`,
    });
  }
}
