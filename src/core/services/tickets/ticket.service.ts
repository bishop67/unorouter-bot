import { db } from "@/lib/db";
import { ticket, ticketMessage } from "@/lib/db-schema";
import { botLogger } from "@/lib/telemetry";
import { STAFF_ROLES } from "@/shared/config/roles";
import { findCategory, findTextChannel } from "@/shared/utils/channel.utils";
import { and, eq } from "drizzle-orm";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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

export type TicketCategory = "support" | "bug";

export class TicketService {
  static buildControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Claim")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ticket_reward")
        .setLabel("Approve & Reward")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ticket_close")
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
  ): Promise<TextChannel | null> {
    const ticketsCategory = findCategory(guild, TICKET_CATEGORY_NAME);
    if (!ticketsCategory) {
      botLogger.error("Ticket open failed: TICKETS category not found", {
        name: TICKET_CATEGORY_NAME,
      });
      return null;
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
                PermissionFlagsBits.AttachFiles |
                PermissionFlagsBits.ManageChannels |
                PermissionFlagsBits.ManageRoles |
                PermissionFlagsBits.ManageMessages,
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
      botLogger.error("Ticket channel create failed", { error: String(err) });
      return null;
    }

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

    return channel;
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
        authorTag: message.author.tag,
        content: message.content || "(no text content)",
      })
      .catch(() => {});
  }

  static async claim(
    channel: GuildTextBasedChannel,
    staff: GuildMember,
  ): Promise<boolean> {
    const row = await this.getOpenTicket(channel.id);
    if (!row) return false;
    await db
      .update(ticket)
      .set({ claimedBy: staff.id })
      .where(eq(ticket.id, row.id));
    return true;
  }

  static async close(channel: GuildTextBasedChannel): Promise<boolean> {
    const row = await this.getOpenTicket(channel.id);
    if (!row) return false;

    await db
      .update(ticket)
      .set({ status: "closed", closedAt: new Date().toISOString() })
      .where(eq(ticket.id, row.id));

    const transcript = await this.buildTranscript(row.id, channel.name);
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
      where: and(eq(ticket.channelId, channelId), eq(ticket.status, "open")),
    });
  }

  private static async buildTranscript(
    ticketId: number,
    channelName: string,
  ): Promise<AttachmentBuilder> {
    const messages = await db.query.ticketMessage.findMany({
      where: eq(ticketMessage.ticketId, ticketId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    const lines = messages.map(
      (m) => `[${m.createdAt}] ${m.authorTag}: ${m.content}`,
    );
    const body = `Transcript for ticket #${ticketId} (${channelName})\n\n${lines.join("\n")}\n`;
    return new AttachmentBuilder(Buffer.from(body, "utf-8"), {
      name: `ticket-${ticketId}.txt`,
    });
  }
}
