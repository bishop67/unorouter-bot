import { ServerTagService } from "@/core/services/server-tag/server-tag.service";
import { db } from "@/lib/db";
import { serverTagWear } from "@/lib/db-schema";
import { REWARDS, formatDollars } from "@/shared/config/rewards";
import { ButtonId } from "@/types/custom-ids";
import { and, eq } from "drizzle-orm";
import { ButtonInteraction, GuildMember, MessageFlags, time } from "discord.js";
import { ButtonComponent, Discord } from "discordx";

@Discord()
export class ServerTagInteractions {
  /**
   * Reports whether the member is wearing the tag and when their next payout
   * lands. Discord exposes no API for SETTING a user's tag (it is a profile
   * setting only the user's own client can change), so this can only check and
   * explain, never apply.
   */
  @ButtonComponent({ id: ButtonId.ServerTagStatus })
  async status(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.editReply("Guild only.");
      return;
    }
    if (REWARDS.serverTag <= 0) {
      await interaction.editReply("Server tag rewards are not active right now.");
      return;
    }

    const perDay = `**$${formatDollars(REWARDS.serverTag)}**`;
    const howTo =
      "Set it in **User Settings -> Profiles -> Server Tag** and pick this server. Discord does not let bots set it for you.";

    if (!ServerTagService.isWearingTag(member.user, interaction.guildId!)) {
      await interaction.editReply(
        `You are **not** wearing the server tag right now, so nothing is accruing.\n\n${howTo}\n\nOnce it is on, you earn ${perDay} for every full day you keep it.`,
      );
      return;
    }

    const wear = await db.query.serverTagWear
      .findFirst({
        where: and(
          eq(serverTagWear.memberId, member.id),
          eq(serverTagWear.guildId, interaction.guildId!),
          eq(serverTagWear.active, true),
        ),
      })
      .catch(() => null);

    if (!wear) {
      await interaction.editReply(
        `You are wearing the server tag. Your first day starts within the hour, then ${perDay} lands for every full day you keep it on.`,
      );
      return;
    }

    await interaction.editReply(
      [
        `You are wearing the server tag and earning ${perDay} per day.`,
        `Wearing since ${time(new Date(wear.startedAt), "R")}.`,
        `Next payout ${time(new Date(wear.nextPayoutAt), "R")}.`,
        "",
        "Taking the tag off ends the current day with no payout, and putting it back on starts a fresh one.",
      ].join("\n"),
    );
  }
}
