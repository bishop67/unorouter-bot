import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import {
  canTransfer,
  isLinked,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

const QUOTA_PER_DOLLAR = parseInt(process.env.QUOTA_PER_DOLLAR || "500000", 10);
const fmtDollars = (dollars: number) =>
  Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;

@Discord()
export class TransferCommand {
  @Slash({
    name: "transfer",
    description: "Send some of your own balance to another linked member",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
  })
  async transfer(
    @SlashOption({
      name: "user",
      description: "Member to send balance to",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      name: "amount",
      description: "Dollar amount to send (e.g. 1 = $1)",
      required: true,
      minValue: 0,
      type: ApplicationCommandOptionType.Number,
    })
    amount: number,
    interaction: CommandInteraction,
  ) {
    if (
      !(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] }))
    )
      return;

    const caller = interaction.member as GuildMember | null;
    if (!canTransfer(caller)) {
      await safeEditReply(
        interaction,
        "You are not allowed to use this command.",
      );
      return;
    }
    if (!isLinked(caller)) {
      await safeEditReply(
        interaction,
        `You need to link your Discord account first. ${GrantService.linkPrompt()}`,
      );
      return;
    }
    if (user.bot) {
      await safeEditReply(interaction, "You cannot send balance to a bot.");
      return;
    }
    if (user.id === interaction.user.id) {
      await safeEditReply(interaction, "You cannot send balance to yourself.");
      return;
    }

    if (!GrantService.isConfigured()) {
      await safeEditReply(interaction, "Transfers are not configured on this bot.");
      return;
    }

    const quota = dollarsToQuota(amount);
    if (quota <= 0) {
      await safeEditReply(interaction, "Amount must be greater than 0.");
      return;
    }

    try {
      const result = await GrantService.transferQuota({
        fromDiscordId: interaction.user.id,
        toDiscordId: user.id,
        quota,
      });

      if (result.ok) {
        const balance = fmtDollars(result.fromBalanceQuota / QUOTA_PER_DOLLAR);
        await safeEditReply(
          interaction,
          `Sent **${fmtDollars(amount)}** to <@${user.id}>. Your balance: ${balance}.`,
        );
        return;
      }

      switch (result.reason) {
        case "receiver_not_linked":
          await safeEditReply(
            interaction,
            `<@${user.id}> has not linked their Discord account, so they cannot receive balance yet.`,
          );
          return;
        case "sender_not_linked":
          await safeEditReply(
            interaction,
            `You need to link your Discord account first. ${GrantService.linkPrompt()}`,
          );
          return;
        case "insufficient": {
          const have =
            result.fromBalanceQuota != null
              ? fmtDollars(result.fromBalanceQuota / QUOTA_PER_DOLLAR)
              : "less than that";
          await safeEditReply(
            interaction,
            `You only have ${have} - not enough to send ${fmtDollars(amount)}.`,
          );
          return;
        }
        default:
          await safeEditReply(interaction, "Transfer could not be completed.");
      }
    } catch (err) {
      logger.error("/transfer failed", { error: String(err) });
      await safeEditReply(interaction, "Transfer failed. Check the bot logs.");
    }
  }
}
