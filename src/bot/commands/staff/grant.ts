import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import {
  isStaff,
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

@Discord()
export class GrantCommand {
  @Slash({
    name: "grant",
    description:
      "Grant free balance to a member who linked their Discord account",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  })
  async grant(
    @SlashOption({
      name: "user",
      description: "Member to reward",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      name: "amount",
      description: "Dollar amount to grant (e.g. 1 = $1)",
      required: true,
      minValue: 0,
      type: ApplicationCommandOptionType.Number,
    })
    amount: number,
    @SlashOption({
      name: "reason",
      description: "Why they are being rewarded",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ) {
    if (
      !(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] }))
    )
      return;

    if (!isStaff(interaction.member as GuildMember)) {
      await safeEditReply(
        interaction,
        "You are not allowed to use this command.",
      );
      return;
    }

    if (!GrantService.isConfigured()) {
      await safeEditReply(
        interaction,
        "Grants are not configured on this bot.",
      );
      return;
    }

    const quota = dollarsToQuota(amount);
    if (quota <= 0) {
      await safeEditReply(interaction, "Amount must be greater than 0.");
      return;
    }

    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: user.id,
        quota,
        reason,
        sourceType: "command",
        grantedByDiscordId: interaction.user.id,
      });

      if (!result.linked) {
        await safeEditReply(
          interaction,
          `${user.tag} has not linked their Discord. ${GrantService.linkPrompt()}`,
        );
        return;
      }

      await safeEditReply(
        interaction,
        `Granted **$${amount}** to ${user.tag}. Reason: ${reason}`,
      );
    } catch (err) {
      logger.error("/grant failed", { error: String(err) });
      await safeEditReply(interaction, "Grant failed. Check the bot logs.");
    }
  }
}
