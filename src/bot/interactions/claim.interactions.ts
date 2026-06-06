import {
  ConnectStatus,
  GrantService,
} from "@/core/services/grant/grant.service";
import { logger } from "@/lib/logger";
import { ButtonId } from "@/types/custom-ids";
import { ButtonInteraction, GuildMember, MessageFlags } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

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
