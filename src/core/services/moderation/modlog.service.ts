import { db } from "@/lib/db";
import { modLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { JAIL, STATUS_ROLES } from "@/shared/config/roles";
import { findTextChannel } from "@/shared/utils/channel.utils";
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  type Message,
  type User,
} from "discord.js";
import { and, desc, eq, inArray } from "drizzle-orm";

const ACTION_COLORS = {
  "User Warned": 0xfee75c,
  "User Jailed": 0xed4245,
  "User Unjailed": 0x57f287,
  "User Kicked": 0xed4245,
  "User Banned": 0xed4245,
  "User Unbanned": 0x57f287,
  "User Timed Out": 0xfee75c,
  "User Untimed Out": 0x57f287,
  "Messages Deleted": 0xed4245,
  "Channel Purged": 0xed4245,
} as const;

export type ModAction = keyof typeof ACTION_COLORS;

interface ModLogEntry {
  action: ModAction;
  targetId: string;
  moderatorId: string | null;
  reason?: string | null;
  note?: string;
  amount?: number;
  expiresAt?: Date | null;
}

interface LoggedEntry {
  id?: number;
  entry: ModLogEntry;
  user: User | null;
  message: Message | null;
}

export const utcMs = (value: string) =>
  Date.parse(`${value.replace(" ", "T")}Z`);

// A purge targets a channel, every other action targets a member.
const targetsChannel = (action: string) => action === "Channel Purged";

export const targetMention = (action: string, targetId: string) =>
  targetsChannel(action) ? `<#${targetId}>` : `<@${targetId}>`;

const changesRole = (
  entry: GuildAuditLogsEntry,
  key: "$add" | "$remove",
  matches: (name: string) => boolean,
) =>
  entry.changes.some(
    (change) =>
      change.key === key &&
      Array.isArray(change.new) &&
      change.new.some((role) => matches(role.name)),
  );

const isJail = (name: string) => name === JAIL;
const isOtherStatusRole = (name: string) =>
  !isJail(name) && STATUS_ROLES.includes(name);

export class ModLogService {
  static async actionFromAudit(
    guild: Guild,
    entry: GuildAuditLogsEntry,
  ): Promise<ModAction | null> {
    switch (entry.action) {
      case AuditLogEvent.MemberKick:
        return "User Kicked";
      case AuditLogEvent.MemberBanAdd:
        return "User Banned";
      case AuditLogEvent.MemberBanRemove:
        return "User Unbanned";
      case AuditLogEvent.MemberUpdate: {
        const change = entry.changes.find(
          (c) => c.key === "communication_disabled_until",
        );
        if (!change) return null;
        return change.new ? "User Timed Out" : "User Untimed Out";
      }
      case AuditLogEvent.MemberRoleUpdate:
        if (!JAIL || !entry.targetId) return null;
        if (changesRole(entry, "$add", isJail)) return "User Jailed";
        if (changesRole(entry, "$remove", isJail)) return "User Unjailed";
        return changesRole(entry, "$add", isOtherStatusRole) &&
          (await this.isJailed(guild, entry.targetId))
          ? "User Unjailed"
          : null;
      default:
        return null;
    }
  }

  private static embed(entry: ModLogEntry, user: User | null, at: Date) {
    const mention = targetMention(entry.action, entry.targetId);
    const lines = [
      `**${entry.action}**`,
      targetsChannel(entry.action)
        ? mention
        : `${mention} (${user?.username ?? "unknown"})`,
      `**By:** ${entry.moderatorId ? `<@${entry.moderatorId}>` : "unknown"}`,
      entry.amount !== undefined && `**Amount:** ${entry.amount}`,
      entry.reason && `**Reason:** ${entry.reason.slice(0, 1000)}`,
      entry.note && `**Note:** ${entry.note}`,
      `-# ${entry.targetId}`,
    ];

    return {
      color: ACTION_COLORS[entry.action],
      author: user
        ? { name: user.username, icon_url: user.displayAvatarURL() }
        : undefined,
      description: lines.filter(Boolean).join("\n"),
      timestamp: at.toISOString(),
      footer: { text: "Mod Log" },
    };
  }

  static async record(guild: Guild, input: ModLogEntry): Promise<LoggedEntry> {
    const entry = { ...input, reason: input.reason?.trim() || null };

    const [row] = await db
      .insert(modLog)
      .values({
        guildId: guild.id,
        action: entry.action,
        targetId: entry.targetId,
        moderatorId: entry.moderatorId,
        reason: entry.reason,
        amount: entry.amount ?? null,
        expiresAt: entry.expiresAt?.toISOString() ?? null,
      })
      .returning({ id: modLog.id })
      .catch((err) => {
        logger.error("modlog insert failed", { err });
        return [];
      });
    const logged: LoggedEntry = { id: row?.id, entry, user: null, message: null };

    const channel = findTextChannel(
      guild,
      process.env.MOD_LOG_CHANNEL?.trim() || "mod-logs",
    );
    if (!channel) return logged;

    if (!targetsChannel(entry.action))
      logged.user = await guild.client.users
        .fetch(entry.targetId)
        .catch(() => null);

    logged.message = await channel
      .send({
        embeds: [this.embed(entry, logged.user, new Date())],
        allowedMentions: { parse: [] },
      })
      .catch((err) => {
        logger.error("modlog post failed", { err });
        return null;
      });
    return logged;
  }

  // Fills in the count on an entry recorded before the work that produces it.
  static async setAmount(logged: LoggedEntry, amount: number) {
    if (logged.id !== undefined)
      await db
        .update(modLog)
        .set({ amount })
        .where(eq(modLog.id, logged.id))
        .catch((err) => logger.error("modlog amount update failed", { err }));

    await logged.message
      ?.edit({
        embeds: [
          this.embed(
            { ...logged.entry, amount },
            logged.user,
            logged.message.createdAt,
          ),
        ],
        allowedMentions: { parse: [] },
      })
      .catch((err) => logger.error("modlog amount edit failed", { err }));
  }

  private static async latest(
    guildId: string,
    targetId: string,
    actions: [ModAction, ModAction],
  ) {
    const [row] = await db
      .select()
      .from(modLog)
      .where(
        and(
          eq(modLog.guildId, guildId),
          eq(modLog.targetId, targetId),
          inArray(modLog.action, actions),
        ),
      )
      .orderBy(desc(modLog.createdAt), desc(modLog.id))
      .limit(1);
    return row;
  }

  static async timeoutSetter(
    guildId: string,
    targetId: string,
  ): Promise<string | null> {
    const latest = await this.latest(guildId, targetId, [
      "User Timed Out",
      "User Untimed Out",
    ]);
    if (latest?.action !== "User Timed Out" || !latest.expiresAt) return null;
    return utcMs(latest.expiresAt) > Date.now() ? latest.moderatorId : null;
  }

  static async jailSetter(
    guildId: string,
    targetId: string,
  ): Promise<string | null> {
    const latest = await this.latest(guildId, targetId, [
      "User Jailed",
      "User Unjailed",
    ]);
    return latest?.action === "User Jailed" ? latest.moderatorId : null;
  }

  static async isJailed(guild: Guild, targetId: string): Promise<boolean> {
    const member = guild.members.cache.get(targetId);
    if (member?.roles.cache.some((role) => isJail(role.name))) return true;
    return (await this.jailSetter(guild.id, targetId)) !== null;
  }

  static recent(guildId: string, targetId?: string) {
    return db
      .select()
      .from(modLog)
      .where(
        targetId
          ? and(eq(modLog.guildId, guildId), eq(modLog.targetId, targetId))
          : eq(modLog.guildId, guildId),
      )
      .orderBy(desc(modLog.createdAt))
      .limit(20);
  }
}
