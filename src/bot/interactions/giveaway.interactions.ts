import { GiveawayService } from "@/core/services/giveaway/giveaway.service";
import { GIVEAWAY_WEIGHTS } from "@/shared/config/giveaway";
import { ButtonId } from "@/types/custom-ids";
import { ButtonInteraction, GuildMember, MessageFlags } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

@Discord()
export class GiveawayInteractions {
  /**
   * A member's own standing. This is the only way someone who never posts finds
   * out their votes and server tag are already scoring, which is most of the
   * people eligible to win.
   */
  @ButtonComponent({ id: ButtonId.GiveawayScore })
  async score(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const member = interaction.member as GuildMember | null;
    if (!member || !interaction.guildId) {
      await interaction.editReply("Guild only.");
      return;
    }

    const round = await GiveawayService.openRound(interaction.guildId);
    if (!round) {
      await interaction.editReply("No giveaway is running right now.");
      return;
    }

    const result = await GiveawayService.memberScore(
      round,
      member.id,
      interaction.guild ?? undefined,
    );
    if (!result.entry) {
      const w = GIVEAWAY_WEIGHTS;
      await interaction.editReply(
        [
          "You have **0 points** this round.",
          "",
          "You do not need to chat to score:",
          `- Vote for us on the listing sites - **${w.vote} pts** each`,
          `- Wear our server tag - **${w.serverTag} pts**`,
          `- Invite someone who joins - **${w.invite} pts**`,
          `- Boost the server - **${w.boost} pts**`,
          "",
          "If you are not verified yet, link your account first - only verified members can win.",
        ].join("\n"),
      );
      return;
    }

    await interaction.editReply(
      [
        `You have **${result.entry.score} points** this round.`,
        `Currently **#${result.place}** of ${result.total} participants.`,
        "",
        `From: ${GiveawayService.formatBreakdown(result.entry.breakdown)}`,
        "",
        "Top scorers win outright; everyone else with points goes into the random draw.",
      ].join("\n"),
    );
  }
}
