import {
  ConnectStatus,
  GrantService,
} from "@/core/services/grant/grant.service";
import { InviteService } from "@/core/services/invites/invite.service";
import { LevelRewardService } from "@/core/services/levels/level-reward.service";
import { VoteService } from "@/core/services/vote/vote.service";
import { logger } from "@/lib/logger";
import { ButtonId } from "@/types/custom-ids";
import { ButtonInteraction, GuildMember, MessageFlags, time } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

const MIN_ACCOUNT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Discord()
export class ClaimInteractions {
  @ButtonComponent({ id: ButtonId.ClaimConnect })
  async claim(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.editReply("Guild only.");
      return;
    }

    // Reject accounts younger than 30 days to curb throwaway-account farming.
    const accountAge = interaction.createdTimestamp - member.user.createdTimestamp;
    if (accountAge < MIN_ACCOUNT_AGE_MS) {
      const eligibleAt = new Date(
        member.user.createdTimestamp + MIN_ACCOUNT_AGE_MS,
      );
      await interaction.editReply(
        `Your Discord account is too new to verify. Accounts must be at least 30 days old. You can claim ${time(eligibleAt, "R")}.`,
      );
      return;
    }

    if (!GrantService.isConfigured()) {
      await interaction.editReply("Account linking is not configured yet.");
      return;
    }

    try {
      const result = await GrantService.connectBonus(member);

      if (result.status === ConnectStatus.NotLinked) {
        await interaction.editReply(GrantService.linkPrompt());
        return;
      }

      // Just linked: pay out any level/invite/vote backlog they earned while
      // unlinked. Detached, idempotent (ledger guards against double-pay).
      void LevelRewardService.reconcileMember(member);
      void InviteService.reconcileInviter(member.guild.id, member.id);
      void VoteService.handleVoteRole(member);

      if (result.bonusGranted) {
        await interaction.editReply(
          `Linked! You received the connected role and a one-time **$${result.dollars}** balance bonus. Thanks for joining!`,
        );
      } else {
        await interaction.editReply(
          "Linked! You already claimed your bonus - the connected role is set.",
        );
      }
    } catch (err) {
      logger.error("Claim connect failed", { error: String(err) });
      await interaction.editReply("Something went wrong. Try again later.");
    }
  }
}
