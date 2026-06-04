import { BugReportService } from "@/core/services/bugs/bug-report.service";
import { dollarsToQuota, GrantService } from "@/core/services/grant/grant.service";
import { isStaff } from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import {
  buildRewardModal,
  parseRewardModal,
} from "@/bot/interactions/reward.modal";
import {
  ButtonId,
  ButtonIdPattern,
  ModalIdPattern,
} from "@/types/custom-ids";
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
  @ButtonComponent({ id: ButtonId.BugReward })
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
    if (row.resolvedAt) {
      await interaction.reply({
        content: "This bug report has already been resolved.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    await interaction.showModal(
      buildRewardModal("bug", String(row.id), row.reporterId),
    );
  }

  @ButtonComponent({ id: ButtonId.BugReject })
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

  @ModalComponent({ id: ModalIdPattern.RewardBug })
  async rewardSubmit(interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const parsed = parseRewardModal(interaction);
    if (!parsed) {
      await interaction.editReply("Invalid amount.");
      return;
    }
    const bugId = Number(parsed.sourceId);
    const row = await BugReportService.getById(bugId);
    if (!row) {
      await interaction.editReply("Bug report not found.");
      return;
    }
    if (row.resolvedAt) {
      await interaction.editReply("Bug report already resolved.");
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

      if (result.linked) {
        await BugReportService.markApproved(
          row.forumThreadId,
          interaction.user.id,
          quota,
        );
        await interaction.editReply(
          `Approved and granted **$${parsed.amount}** to <@${parsed.targetId}>. Reason: ${parsed.reason}`,
        );
        const thread = interaction.channel as ThreadChannel | null;
        await thread?.setArchived(true).catch(() => {});
        return;
      }

      // Not linked: stash pending intent + post self-redeem button.
      await BugReportService.setPendingReward({
        bugId,
        quota,
        reason: parsed.reason,
        grantedBy: interaction.user.id,
      });

      const thread = interaction.channel as ThreadChannel | null;
      await thread?.send({
        content: `<@${parsed.targetId}> your reward of **$${parsed.amount}** is waiting. ${GrantService.linkPrompt()} Then click below to redeem.`,
        components: [BugReportService.buildRedeemButton(bugId)],
        allowedMentions: { users: [parsed.targetId] },
      });
      await interaction.editReply(
        `Pending **$${parsed.amount}** for <@${parsed.targetId}>. They'll self-redeem after linking.`,
      );
    } catch (err) {
      logger.error("Bug reward failed", { error: String(err) });
      await interaction.editReply("Grant failed.");
    }
  }

  @ButtonComponent({ id: ButtonIdPattern.BugRedeem })
  async redeem(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const bugId = Number(interaction.customId.split(":")[1]);
    const row = await BugReportService.getById(bugId);
    if (!row) {
      await interaction.editReply("Bug report not found.");
      return;
    }
    if (row.resolvedAt) {
      await interaction.editReply("Already redeemed.");
      return;
    }
    if (interaction.user.id !== row.reporterId) {
      await interaction.editReply("Only the reporter can redeem this.");
      return;
    }
    if (
      row.pendingRewardQuota == null ||
      !row.pendingRewardReason ||
      !row.pendingRewardGrantedBy
    ) {
      await interaction.editReply("No pending reward on this report.");
      return;
    }

    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: row.reporterId,
        quota: row.pendingRewardQuota,
        reason: row.pendingRewardReason,
        sourceType: "bug",
        sourceId: String(row.id),
        grantedByDiscordId: row.pendingRewardGrantedBy,
      });
      if (!result.linked) {
        await interaction.editReply(
          `Still not linked. ${GrantService.linkPrompt()}`,
        );
        return;
      }
      await BugReportService.markApproved(
        row.forumThreadId,
        row.pendingRewardGrantedBy,
        row.pendingRewardQuota,
      );
      await interaction.editReply("Reward delivered to your balance.");
      const thread = interaction.channel as ThreadChannel | null;
      await thread?.setArchived(true).catch(() => {});
    } catch (err) {
      logger.error("Bug redeem failed", { error: String(err) });
      await interaction.editReply("Redeem failed. Try again in a moment.");
    }
  }
}
