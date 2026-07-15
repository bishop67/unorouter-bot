import { membersEmbed } from "@/core/embeds/members.embed";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class MembersCommand {
  @Slash({
    name: "members",
    description: "Member count and growth chart for this server",
    dmPermission: false,
  })
  async members(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction))) return;
    if (!interaction.guild) {
      await safeEditReply(interaction, "Please use this command in a server.");
      return;
    }

    const stats = await MemberDataService.memberFlowStats(interaction.guild);
    if (!stats) {
      await safeEditReply(interaction, "No member data found.");
      return;
    }

    await safeEditReply(interaction, {
      embeds: [membersEmbed(interaction.guild.name, stats)],
      files: [{ attachment: stats.buffer, name: stats.fileName }],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
