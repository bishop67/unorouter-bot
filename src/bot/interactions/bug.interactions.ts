import { BugReportService } from "@/core/services/bugs/bug-report.service";
import { dollarsToQuota, GrantService } from "@/core/services/grant/grant.service";
import { isStaff } from "@/core/utils/command.utils";
import { botLogger } from "@/lib/telemetry";
import {
  buildRewardModal,
  parseRewardModal,
  REWARD_MODAL_PREFIX,
} from "@/bot/interactions/reward.modal";
import {
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  ThreadChannel,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent } from "discordx";

@Discord()
export class BugInteractions {
  @ButtonComponent({ id: "bug_reward" })
  async reward(interaction: ButtonInteraction) {
    if (!isStaff(interaction.member as GuildMember)) {
      await interaction.reply({
        content: "Staff only.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const row = await BugReportService.getOpen(interaction.channelId);
    if (!row) {
      await interaction.reply({
        content: "This bug report is not open.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    await interaction.showModal(
      buildRewardModal("bug", interaction.channelId, row.reporterId),
    );
  }

  @ButtonComponent({ id: "bug_reject" })
  async reject(interaction: ButtonInteraction) {
    if (!isStaff(interaction.member as GuildMember)) {
      await interaction.reply({
        content: "Staff only.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const row = await BugReportService.getOpen(interaction.channelId);
    if (!row) {
      await interaction.reply({
        content: "This bug report is not open.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    await BugReportService.markRejected(interaction.channelId, interaction.user.id);
    await interaction.reply({ content: "Bug report rejected." });
    const thread = interaction.channel as ThreadChannel;
    await thread.setArchived(true).catch(() => {});
  }

  @ModalComponent({ id: new RegExp(`^${REWARD_MODAL_PREFIX}bug:`) })
  async rewardSubmit(interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const parsed = parseRewardModal(interaction);
    if (!parsed) {
      await interaction.editReply("Invalid amount.");
      return;
    }
    const quota = dollarsToQuota(parsed.amount);
    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: parsed.targetId,
        quota,
        reason: parsed.reason,
        sourceType: "bug",
        sourceId: parsed.sourceId,
        grantedByDiscordId: interaction.user.id,
      });

      if (!result.linked) {
        const thread = interaction.channel as ThreadChannel | null;
        await thread?.send({
          content: `<@${parsed.targetId}> your reward of **$${parsed.amount}** is waiting. ${GrantService.linkPrompt()} A staff member will then reclick **Approve & Reward** to release it.`,
          allowedMentions: { users: [parsed.targetId] },
        });
        await interaction.editReply(
          `Reporter not linked yet. I pinged them in the thread; reclick **Approve & Reward** after they link.`,
        );
        return;
      }

      await BugReportService.markApproved(
        parsed.sourceId,
        interaction.user.id,
        quota,
      );
      await interaction.editReply(
        `Approved and granted **$${parsed.amount}** to <@${parsed.targetId}>. Reason: ${parsed.reason}`,
      );
      const thread = interaction.channel as ThreadChannel;
      await thread.setArchived(true).catch(() => {});
    } catch (err) {
      botLogger.error("Bug reward failed", { error: String(err) });
      await interaction.editReply("Grant failed.");
    }
  }
}
