import { GiveawayService } from "@/core/services/giveaway/giveaway.service";
import {
  isAdmin,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import {
  GIVEAWAY_PRIZES,
  GIVEAWAY_RANKED_COUNT,
} from "@/shared/config/giveaway";
import {
  CommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Slash } from "discordx";

const PURPLE = 0x9b59ff;

@Discord()
export class GiveawayCommands {
  @Slash({
    name: "giveaway-status",
    description: "Current giveaway standings",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async status(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const round = await GiveawayService.openRound(guild.id);
    if (!round) {
      await safeEditReply(interaction, "No round is open.");
      return;
    }
    await guild.members.fetch().catch(() => null);
    const top = await GiveawayService.standings(round, 15, guild);
    if (!top.length) {
      await safeEditReply(interaction, `Round #${round.id}: nobody has scored yet.`);
      return;
    }
    await safeEditReply(interaction, {
      content: [
        `**Round #${round.id}** - ${top.length} shown, opened <t:${Math.floor(new Date(round.startedAt).getTime() / 1000)}:R>`,
        ...top.map(
          (e, i) =>
            `${i + 1}. <@${e.memberId}> - **${e.score}** (${GiveawayService.formatBreakdown(e.breakdown)})`,
        ),
      ].join("\n"),
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({
    name: "giveaway-stats",
    description: "All-time giveaway leaderboard",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async stats(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const rows = await GiveawayService.leaderboard(guild.id, 15);
    if (!rows.length) {
      await safeEditReply(interaction, "No giveaway history yet.");
      return;
    }
    await safeEditReply(interaction, {
      content: [
        "**All-time giveaway leaderboard**",
        ...rows.map(
          (r, i) =>
            `${i + 1}. <@${r.member_id}> - **${r.wins}** win(s), ${r.total_score} pts across ${r.rounds} round(s)`,
        ),
      ].join("\n"),
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({
    name: "giveaway-leaderboard",
    description: "See the current giveaway standings",
    dmPermission: false,
  })
  async leaderboard(interaction: CommandInteraction) {
    // Public on purpose: a ranked board nobody can see is not a competition.
    if (!(await safeDeferReply(interaction))) return;
    const guild = interaction.guild;
    if (!guild) return;

    const round = await GiveawayService.openRound(guild.id);
    if (!round) {
      await safeEditReply(interaction, "No giveaway is running right now.");
      return;
    }
    await guild.members.fetch().catch(() => null);
    const all = await GiveawayService.scoreRound(round, guild);
    if (!all.length) {
      await safeEditReply(interaction, "Nobody has scored yet this round.");
      return;
    }

    const top = all.slice(0, 10);
    const mine = all.findIndex((e) => e.memberId === interaction.user.id);
    const ids = top.map((e) => e.memberId);
    if (mine >= 0) ids.push(interaction.user.id);
    // Plain names, not <@id>: a mention renders as "unknown-user" for anyone the
    // viewer has not cached, which is most of the board.
    const names = await GiveawayService.displayNames(ids, guild);

    const medals = ["🥇", "🥈", "🥉"];
    const board = top.map((e, i) => {
      const rank = i < 3 ? medals[i] : `**#${i + 1}**`;
      // Only the ranked places are won by position. The remaining prizes are
      // drawn at random, so showing them next to #4 and #5 promised those
      // members a payout that rank has nothing to do with.
      const prize =
        i < GIVEAWAY_RANKED_COUNT
          ? ` - ${GiveawayService.formatPrize(GIVEAWAY_PRIZES[i]!)}`
          : "";
      return `${rank} ${names.get(e.memberId)} \`${e.score} pts\`${prize}`;
    });

    const randomPrizes = GIVEAWAY_PRIZES.slice(GIVEAWAY_RANKED_COUNT);
    const randomLine = randomPrizes.length
      ? `🎲 ${randomPrizes.map((d) => GiveawayService.formatPrize(d)).join(" + ")} drawn at random from **everyone else with points** (${Math.max(all.length - GIVEAWAY_RANKED_COUNT, 0)} in the draw)`
      : "";
    const total = GIVEAWAY_PRIZES.reduce((a, b) => a + b, 0);
    const embed = new EmbedBuilder()
      .setTitle("🏆 Giveaway standings")
      .setDescription(
        [
          `Round #${round.id} - **${all.length}** taking part, ${GiveawayService.formatPrize(total)} on the line.`,
          "",
          ...board,
          "",
          ...(randomLine ? [randomLine, ""] : []),
          mine >= 0
            ? `You are **#${mine + 1}** with \`${all[mine]!.score} pts\` (${GiveawayService.formatBreakdown(all[mine]!.breakdown)})`
            : "You have not scored yet. Voting, wearing the server tag, inviting and boosting all count - none of it needs chatting.",
        ].join("\n"),
      )
      .setColor(PURPLE)
      .setFooter({ text: `Top ${GIVEAWAY_RANKED_COUNT} win by points; the rest are drawn at random` })
      .setTimestamp(new Date());

    await safeEditReply(interaction, {
      embeds: [embed],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
