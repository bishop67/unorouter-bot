import { db } from "@/lib/db";
import { modLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { JAIL } from "@/shared/config/roles";
import { findTextChannel } from "@/shared/utils/channel.utils";
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
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
} as const;

export type ModAction = keyof typeof ACTION_COLORS;

interface ModLogEntry {
  action: ModAction;
  targetId: string;
  moderatorId: string | null;
  reason?: string | null;
  note?: string;
  expiresAt?: Date | null;
}

export const utcMs = (value: string) =>
  Date.parse(`${value.replace(" ", "T")}Z`);

const changesJail = (entry: GuildAuditLogsEntry, key: "$add" | "$remove") =>
  entry.changes.some(
    (change) =>
      change.key === key &&
      Array.isArray(change.new) &&
      change.new.some((role) => role.name === JAIL),
  );

export class ModLogService {
  static actionFromAudit(entry: GuildAuditLogsEntry): ModAction | null {
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
        if (!JAIL) return null;
        if (changesJail(entry, "$add")) return "User Jailed";
        if (changesJail(entry, "$remove")) return "User Unjailed";
        return null;
      default:
        return null;
    }
  }

  static async record(guild: Guild, entry: ModLogEntry) {
    const reason = entry.reason?.trim() || null;

    await db
      .insert(modLog)
      .values({
        guildId: guild.id,
        action: entry.action,
        targetId: entry.targetId,
        moderatorId: entry.moderatorId,
        reason,
        expiresAt: entry.expiresAt?.toISOString() ?? null,
      })
      .catch((err) => logger.error("modlog insert failed", { err }));

    const channel = findTextChannel(
      guild,
      process.env.MOD_LOG_CHANNEL?.trim() || "mod-logs",
    );
    if (!channel) return;

    const user = await guild.client.users
      .fetch(entry.targetId)
      .catch(() => null);
    const lines = [
      `**${entry.action}**`,
      `<@${entry.targetId}> (${user?.username ?? "unknown"})`,
      `**By:** ${entry.moderatorId ? `<@${entry.moderatorId}>` : "unknown"}`,
      reason && `**Reason:** ${reason.slice(0, 1000)}`,
      entry.note && `**Note:** ${entry.note}`,
      `-# ${entry.targetId}`,
    ];

    await channel
      .send({
        embeds: [
          {
            color: ACTION_COLORS[entry.action],
            author: user
              ? { name: user.username, icon_url: user.displayAvatarURL() }
              : undefined,
            description: lines.filter(Boolean).join("\n"),
            timestamp: new Date().toISOString(),
            footer: { text: "Mod Log" },
          },
        ],
        allowedMentions: { parse: [] },
      })
      .catch((err) => logger.error("modlog post failed", { err }));
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

  static async recordStatusRoleUnjail(
    target: Pick<GuildMember, "id" | "guild">,
    addedRole: string,
  ) {
    const findAdder = async () => {
      const logs = await target.guild
        .fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 })
        .catch(() => null);
      return logs?.entries.find(
        (entry) =>
          entry.targetId === target.id &&
          Date.now() - entry.createdTimestamp < 60_000 &&
          entry.changes.some(
            (change) =>
              change.key === "$add" &&
              Array.isArray(change.new) &&
              change.new.some((role) => role.name === addedRole),
          ),
      );
    };

    let entry = await findAdder();
    if (!entry) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      entry = await findAdder();
    }

    await this.record(target.guild, {
      action: "User Unjailed",
      targetId: target.id,
      moderatorId: entry?.executorId ?? null,
    });
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
