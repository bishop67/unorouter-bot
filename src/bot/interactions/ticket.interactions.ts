import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import {
  TicketCategory,
  TicketOpenStatus,
  TicketService,
} from "@/core/services/tickets/ticket.service";
import { TicketCooldownService } from "@/core/services/tickets/ticket-cooldown.service";
import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import { isStaff } from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import { ButtonId, ButtonIdPattern, ModalIdPattern } from "@/types/custom-ids";
import {
  buildRewardModal,
  parseRewardModal,
} from "@/bot/interactions/reward.modal";
import {
  ButtonInteraction,
  type GuildTextBasedChannel,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent } from "discordx";

function formatRetry(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}m`;
}

/**
 * Churn-limit a ticket open/close. Returns true when the action must be
 * aborted: either soft-blocked (retry hint) or the user got jailed. The jail
 * notification embed (posted to the jail channel) carries the reason, so staff
 * see exactly what tripped it.
 */
async function enforceTicketCooldown(
  interaction: ButtonInteraction,
  member: GuildMember,
  notify: (content: string) => Promise<unknown>,
): Promise<boolean> {
  const cooldown = TicketCooldownService.check(interaction.user.id);
  if (cooldown.action === "ok") return false;

  if (cooldown.action === "jail") {
    TicketCooldownService.reset(interaction.user.id);
    if (interaction.guild) {
      await DeleteUserMessagesService.jailAndDeleteMessages({
        jail: true,
        memberId: interaction.user.id,
        user: interaction.user,
        guild: interaction.guild,
        reason: `Ticket spam: ${cooldown.count} open/close actions in under 5 minutes`,
      });
    }
    await notify(
      "You've been muted for spamming tickets. Ask a mod to unmute you.",
    );
    return true;
  }

  await notify(
    `You're opening and closing tickets too fast. Try again in ${formatRetry(cooldown.retryAfterMs)}.`,
  );
  return true;
}

@Discord()
export class TicketInteractions {
  @ButtonComponent({ id: ButtonId.TicketOpenSupport })
  async openSupport(interaction: ButtonInteraction) {
    await this.open(interaction, TicketCategory.Support);
  }

  @ButtonComponent({ id: ButtonId.TicketOpenBug })
  async openBug(interaction: ButtonInteraction) {
    await this.open(interaction, TicketCategory.Bug);
  }

  private async open(interaction: ButtonInteraction, category: TicketCategory) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const member = interaction.member as GuildMember | null;
    if (!interaction.guild || !member) {
      await interaction.editReply("Guild only.");
      return;
    }

    const stopped = await enforceTicketCooldown(interaction, member, (c) =>
      interaction.editReply(c),
    );
    if (stopped) return;
    try {
      const result = await TicketService.open(
        interaction.guild,
        member,
        category,
      );
      switch (result.status) {
        case TicketOpenStatus.Ok:
          await interaction.editReply(`Ticket created: ${result.channel}`);
          return;
        case TicketOpenStatus.AlreadyOpen:
          await interaction.editReply(
            `You already have an open ticket: <#${result.channelId}>. Close it before opening another.`,
          );
          return;
        case TicketOpenStatus.NoCategory:
          await interaction.editReply(
            "Could not open a ticket. A configured ticket category channel is required.",
          );
          return;
        case TicketOpenStatus.Error:
          await interaction.editReply("Failed to open ticket.");
          return;
      }
    } catch (err) {
      logger.error("Ticket open failed", { error: String(err) });
      await interaction.editReply("Failed to open ticket.");
    }
  }

  @ButtonComponent({ id: ButtonId.TicketClose })
  async close(interaction: ButtonInteraction) {
    const member = interaction.member as GuildMember | null;
    const row = await TicketService.getOpenTicket(interaction.channelId);
    if (!row) {
      await interaction.reply({
        content: "Not an open ticket.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Support: opener or staff can close. Bug: staff only (reward decision pending).
    const isOpener = member?.id === row.openerId;
    const staff = isStaff(member);
    const allowed =
      staff || (isOpener && row.category === TicketCategory.Support);

    if (!allowed) {
      const msg =
        row.category === TicketCategory.Bug
          ? "Only staff can close bug reports."
          : "Only the opener or staff can close this ticket.";
      await interaction.reply({
        content: msg,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Staff close legitimately during triage; only churn-limit opener self-closes.
    if (!staff && member) {
      const stopped = await enforceTicketCooldown(interaction, member, (c) =>
        interaction.reply({ content: c, flags: [MessageFlags.Ephemeral] }),
      );
      if (stopped) return;
    }

    await interaction.reply({ content: "Closing ticket..." });
    await TicketService.close(interaction.channel as GuildTextBasedChannel);
  }

  @ButtonComponent({ id: ButtonId.TicketReward })
  async reward(interaction: ButtonInteraction) {
    if (!isStaff(interaction.member as GuildMember)) {
      await interaction.reply({
        content: "Staff only.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const row = await TicketService.getOpenTicket(interaction.channelId);
    if (!row) {
      await interaction.reply({
        content: "Not an open ticket.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const claim = await TicketService.getTicketClaim(row.id);
    if (claim?.status === "paid") {
      await interaction.reply({
        content: "This ticket has already been rewarded.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    await interaction.showModal(
      buildRewardModal("ticket", String(row.id), row.openerId),
    );
  }

  @ModalComponent({ id: ModalIdPattern.RewardTicket })
  async rewardSubmit(interaction: ModalSubmitInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const parsed = parseRewardModal(interaction);
    if (!parsed) {
      await interaction.editReply("Invalid amount.");
      return;
    }

    const ticketId = Number(parsed.sourceId);
    const row = await TicketService.getById(ticketId);
    if (!row) {
      await interaction.editReply("Ticket not found.");
      return;
    }
    const existingClaim = await TicketService.getTicketClaim(ticketId);
    if (existingClaim?.status === "paid") {
      await interaction.editReply("This ticket has already been rewarded.");
      return;
    }

    const quota = dollarsToQuota(parsed.amount);
    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: parsed.targetId,
        quota,
        reason: parsed.reason,
        sourceType: "ticket",
        sourceId: parsed.sourceId,
        grantedByDiscordId: interaction.user.id,
      });

      // Persist the intent first so markRedeemed has a claim row to flip, and so
      // the opener can self-redeem after linking when unlinked.
      await TicketService.setPendingReward({
        ticketId,
        guildId: row.guildId,
        targetId: row.openerId,
        quota,
        reason: parsed.reason,
        grantedBy: interaction.user.id,
      });

      if (result.linked) {
        await TicketService.markRedeemed(ticketId, quota);
        await interaction.editReply(
          `Granted **$${parsed.amount}** to <@${parsed.targetId}>.`,
        );
        return;
      }

      const channel = interaction.channel as GuildTextBasedChannel | null;
      await channel?.send({
        content: `<@${parsed.targetId}> your reward of **$${parsed.amount}** is waiting. ${GrantService.linkPrompt()} Then click below to redeem.`,
        components: [TicketService.buildRedeemButton(ticketId)],
        allowedMentions: { users: [parsed.targetId] },
      });
      await interaction.editReply(
        `Pending **$${parsed.amount}** for <@${parsed.targetId}>. They'll self-redeem after linking.`,
      );
    } catch (err) {
      logger.error("Ticket reward failed", { error: String(err) });
      await interaction.editReply("Grant failed.");
    }
  }

  @ButtonComponent({ id: ButtonIdPattern.TicketRedeem })
  async redeem(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const ticketId = Number(interaction.customId.split(":")[1]);
    const row = await TicketService.getById(ticketId);
    if (!row) {
      await interaction.editReply("Ticket not found.");
      return;
    }
    const claim = await TicketService.getTicketClaim(ticketId);
    if (claim?.status === "paid") {
      await interaction.editReply("Already redeemed.");
      return;
    }
    if (interaction.user.id !== claim?.targetMemberId) {
      await interaction.editReply("Only the ticket opener can redeem this.");
      return;
    }
    if (
      claim.status !== "pending" ||
      claim.pendingQuota == null ||
      !claim.pendingReason ||
      !claim.grantedByMemberId
    ) {
      await interaction.editReply("No pending reward on this ticket.");
      return;
    }

    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: claim.targetMemberId,
        quota: claim.pendingQuota,
        reason: claim.pendingReason,
        sourceType: "ticket",
        sourceId: String(row.id),
        grantedByDiscordId: claim.grantedByMemberId,
      });
      if (!result.linked) {
        await interaction.editReply(
          `Still not linked. ${GrantService.linkPrompt()}`,
        );
        return;
      }
      await TicketService.markRedeemed(ticketId, claim.pendingQuota);
      await interaction.editReply("Reward delivered to your balance.");
    } catch (err) {
      logger.error("Ticket redeem failed", { error: String(err) });
      await interaction.editReply("Redeem failed. Try again in a moment.");
    }
  }
}
