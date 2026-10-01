import { ModLogService, utcMs } from "@/core/services/moderation/modlog.service";
import {
  fitLines,
  isModerator,
  safeEditReply,
  STAFF_COMMAND_PERMISSION,
  startStaffCommand,
} from "@/core/utils/command.utils";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class LogsCommand {
  @Slash({
    name: "logs",
    description: "Recent moderation actions, optionally for one member",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
  })
  async logs(
    @SlashOption({
      name: "user",
      description: "Only show actions against this member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    user: User | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await startStaffCommand(interaction, isModerator))) return;

    const rows = await ModLogService.recent(interaction.guild!.id, user?.id);
    if (!rows.length) {
      await safeEditReply(interaction, "No mod log entries.");
      return;
    }

    const lines = rows.map((row) => {
      const when = Math.floor(utcMs(row.createdAt) / 1000);
      const by = row.moderatorId ? ` by <@${row.moderatorId}>` : "";
      const reason = row.reason ? `: ${row.reason.slice(0, 80)}` : "";
      return `<t:${when}:R> **${row.action}** <@${row.targetId}>${by}${reason}`;
    });

    await safeEditReply(interaction, {
      content: fitLines(lines),
      allowedMentions: { parse: [] },
    });
  }
}
