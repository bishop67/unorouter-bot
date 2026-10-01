import { ModLogService, utcMs } from "@/core/services/moderation/modlog.service";
import {
  isModerator,
  safeDeferReply,
  safeEditReply,
  STAFF_COMMAND_PERMISSION,
} from "@/core/utils/command.utils";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
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
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (
      !interaction.guild ||
      !isModerator(interaction.member as GuildMember | null)
    ) {
      await safeEditReply(interaction, "You are not allowed to use this command.");
      return;
    }

    const rows = await ModLogService.recent(interaction.guild.id, user?.id);
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

    let content = "";
    for (const line of lines) {
      if (content.length + line.length + 1 > 2000) break;
      content += (content ? "\n" : "") + line;
    }

    await safeEditReply(interaction, {
      content,
      allowedMentions: { parse: [] },
    });
  }
}
