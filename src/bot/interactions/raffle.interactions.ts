import { RaffleService } from "@/core/services/giveaway/raffle.service";
import { ButtonIdPattern } from "@/types/custom-ids";
import { ButtonInteraction, GuildMember, MessageFlags } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

@Discord()
export class RaffleInteractions {
  @ButtonComponent({ id: ButtonIdPattern.RaffleEnter })
  async enter(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const member = interaction.member as GuildMember | null;
    if (!member || !interaction.guildId) {
      await interaction.editReply("Guild only.");
      return;
    }

    const raffleId = parseInt(interaction.customId.split(":")[1] ?? "", 10);
    const raffle = Number.isFinite(raffleId)
      ? await RaffleService.byId(raffleId, interaction.guildId)
      : null;
    if (!raffle) {
      await interaction.editReply("That raffle no longer exists.");
      return;
    }

    const result = await RaffleService.enter(raffle, member);
    if (!result.ok) {
      await interaction.editReply(
        result.reason === "ended"
          ? "This raffle has already ended."
          : "This one is for verified members only - link your account in the verify channel first, then enter.",
      );
      return;
    }

    await interaction.editReply(
      result.fresh
        ? `You are in for **${raffle.prize}**. ${result.entries} ${result.entries === 1 ? "person has" : "people have"} entered. The winner is drawn when it ends, so keep your DMs open.`
        : `You are already entered for **${raffle.prize}**. ${result.entries} ${result.entries === 1 ? "person has" : "people have"} entered.`,
    );
  }
}
