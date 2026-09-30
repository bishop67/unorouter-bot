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
    // The bot's own actions are recorded where they happen, with the staff member
    // who ran the command; here they would all read "by the bot".
    if (entry.executorId === guild.client.user.id) return;

    const action = ModLogService.actionFromAudit(entry);
    if (!action || !entry.targetId) return;

    // A timeout or jail changed in Discord's own menus skips the commands' rank
    // checks. Checked before recording, since the new entry becomes the standing one.
    const kind =
      action === "User Timed Out" || action === "User Untimed Out"
        ? "timeout"
        : action === "User Unjailed"
          ? "jail"
          : null;
    const setterId =
      kind === "timeout"
        ? await ModLogService.timeoutSetter(guild.id, entry.targetId)
        : kind === "jail"
          ? await ModLogService.jailSetter(guild.id, entry.targetId)
          : null;
    const outranked = entry.executorId
      ? await outrankingSetter(guild, setterId, entry.executorId)
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
        ? `Overrode a ${kind} set by <@${outranked.id}>, who outranks them.`
        : undefined,
    });
  }
}
