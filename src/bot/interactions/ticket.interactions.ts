import { dollarsToQuota, GrantService } from "@/core/services/grant/grant.service";
import {
  TicketCategory,
  TicketOpenStatus,
  TicketService,
} from "@/core/services/tickets/ticket.service";
import { isStaff } from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import {
  buildRewardModal,
  parseRewardModal,
  REWARD_MODAL_PREFIX,
} from "@/bot/interactions/reward.modal";
import {
  ButtonInteraction,
  type GuildTextBasedChannel,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent } from "discordx";

@Discord()
export class TicketInteractions {
  @ButtonComponent({ id: "ticket_open_support" })
  async openSupport(interaction: ButtonInteraction) {
    await this.open(interaction, TicketCategory.Support);
  }

  @ButtonComponent({ id: "ticket_open_bug" })
  async openBug(interaction: ButtonInteraction) {
    await this.open(interaction, TicketCategory.Bug);
  }

  private async open(
    interaction: ButtonInteraction,
    category: TicketCategory,
  ) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const member = interaction.member as GuildMember | null;
    if (!interaction.guild || !member) {
      await interaction.editReply("Guild only.");
      return;
    }
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

  @ButtonComponent({ id: "ticket_close" })
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
      staff ||
      (isOpener && row.category === TicketCategory.Support);

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

    await interaction.reply({ content: "Closing ticket..." });
    await TicketService.close(interaction.channel as GuildTextBasedChannel);
  }

  @ButtonComponent({ id: "ticket_reward" })
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
    if (row.redeemedAt) {
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

  @ModalComponent({ id: new RegExp(`^${REWARD_MODAL_PREFIX}ticket:`) })
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
    if (row.redeemedAt) {
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

      if (result.linked) {
        await TicketService.markRedeemed(ticketId);
        await interaction.editReply(
          `Granted **$${parsed.amount}** to <@${parsed.targetId}>.`,
        );
        return;
      }

      // Not linked: persist the intent so the opener can self-redeem with a
      // single click after they link. Approve & Reward stays locked until then.
      await TicketService.setPendingReward({
        ticketId,
        quota,
        reason: parsed.reason,
        grantedBy: interaction.user.id,
      });

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

  @ButtonComponent({ id: /^ticket_redeem:\d+$/ })
  async redeem(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const ticketId = Number(interaction.customId.split(":")[1]);
    const row = await TicketService.getById(ticketId);
    if (!row) {
      await interaction.editReply("Ticket not found.");
      return;
    }
    if (row.redeemedAt) {
      await interaction.editReply("Already redeemed.");
      return;
    }
    if (interaction.user.id !== row.openerId) {
      await interaction.editReply("Only the ticket opener can redeem this.");
      return;
    }
    if (
      row.pendingRewardQuota == null ||
      !row.pendingRewardReason ||
      !row.pendingRewardGrantedBy
    ) {
      await interaction.editReply("No pending reward on this ticket.");
      return;
    }

    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: row.openerId,
        quota: row.pendingRewardQuota,
        reason: row.pendingRewardReason,
        sourceType: "ticket",
        sourceId: String(row.id),
        grantedByDiscordId: row.pendingRewardGrantedBy,
      });
      if (!result.linked) {
        await interaction.editReply(
          `Still not linked. ${GrantService.linkPrompt()}`,
        );
        return;
      }
      await TicketService.markRedeemed(ticketId);
      await interaction.editReply("Reward delivered to your balance.");
    } catch (err) {
      logger.error("Ticket redeem failed", { error: String(err) });
      await interaction.editReply("Redeem failed. Try again in a moment.");
    }
  }
}
