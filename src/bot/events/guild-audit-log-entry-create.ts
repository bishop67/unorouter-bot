import { ModLogService } from "@/core/services/moderation/modlog.service";
import { outrankingSetter } from "@/core/services/moderation/rank";
import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildAuditLogEntryCreate {
  @On({ event: "guildAuditLogEntryCreate" })
  async guildAuditLogEntryCreate([
    entry,
    guild,
  ]: ArgsOf<"guildAuditLogEntryCreate">): Promise<void> {
    if (entry.executorId === guild.client.user.id) return;

    const action = ModLogService.actionFromAudit(entry);
    if (!action || !entry.targetId) return;

    const outranked =
      entry.executorId &&
      (action === "User Timed Out" || action === "User Untimed Out")
        ? await outrankingSetter(
            guild,
            await ModLogService.timeoutSetter(guild.id, entry.targetId),
            entry.executorId,
          )
        : null;

    const until = entry.changes.find(
      (c) => c.key === "communication_disabled_until",
    )?.new;

    await ModLogService.record(guild, {
      action,
      targetId: entry.targetId,
      moderatorId: entry.executorId,
      reason: entry.reason,
      expiresAt: typeof until === "string" ? new Date(until) : null,
      note: outranked
        ? `Overrode a timeout set by <@${outranked.id}>, who outranks them.`
        : undefined,
    });
  }
}
