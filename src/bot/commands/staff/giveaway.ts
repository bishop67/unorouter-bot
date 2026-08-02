import { GiveawayService } from "@/core/services/giveaway/giveaway.service";
import {
  isAdmin,
  purgeOwnPanels,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import { BOT_NAME } from "@/shared/config/branding";
import {
  GIVEAWAY_ANNOUNCE_CHANNEL,
  GIVEAWAY_PRIZES,
  GIVEAWAY_RANKED_COUNT,
  GIVEAWAY_WEIGHTS,
} from "@/shared/config/giveaway";
import { findTextChannel } from "@/shared/utils/channel.utils";
import { ButtonId } from "@/types/custom-ids";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { Discord, Slash } from "discordx";

const PURPLE = 0x9b59ff;

function prizeLine(): string {
  return GIVEAWAY_PRIZES.map(
    (d, i) =>
      `${i + 1}. ${GiveawayService.formatPrize(d)}${i < GIVEAWAY_RANKED_COUNT ? "" : " (random draw)"}`,
  ).join("\n");
}

@Discord()
export class GiveawayCommands {
  @Slash({
    name: "giveaway-start",
    description: "Open a giveaway round and post the panel",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async start(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) {
      await safeEditReply(interaction, "You are not allowed to use this command.");
      return;
    }
    if (!GiveawayService.isEnabled()) {
      await safeEditReply(interaction, "Giveaways are disabled (GIVEAWAY_PRIZES is empty).");
      return;
    }
    const guild = interaction.guild;
    if (!guild) return;

    const round = await GiveawayService.startRound(guild, interaction.user.id);
    if (!round) {
      await safeEditReply(
        interaction,
        "A round is already open. Run `/giveaway-end` first.",
      );
      return;
    }

    const w = GIVEAWAY_WEIGHTS;
    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${BOT_NAME} giveaway is live`)
      .setDescription(
        [
          `**${GiveawayService.formatPrize(GIVEAWAY_PRIZES.reduce((a, b) => a + b, 0))}** in balance, split across ${GIVEAWAY_PRIZES.length} winners.`,
          "",
          "**You do NOT have to chat to win.** Everything you already do counts:",
          `- Invite someone who joins - **${w.invite} pts**`,
          `- Boost the server - **${w.boost} pts**`,
          `- Wear our server tag - **${w.serverTag} pts**`,
          `- Reach a new level - **${w.level} pts**`,
          `- Vote for us on the listing sites - **${w.vote} pts** each`,
          `- Send a message - **${w.message} pt**`,
          "",
          "**Prizes**",
          prizeLine(),
          "",
          `Top ${GIVEAWAY_RANKED_COUNT} by points win outright. The rest are drawn at random from everyone who scored, so a few points still gives you a real shot.`,
          "",
          "Only verified members can take part. Points reset each round.",
        ].join("\n"),
      )
      .setColor(PURPLE);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonId.GiveawayScore)
        .setLabel("My score")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Success),
    );

    const channel =
      findTextChannel(guild, GIVEAWAY_ANNOUNCE_CHANNEL) ??
      (interaction.channel as TextChannel | null);
    if (!channel) {
      await safeEditReply(interaction, "No channel to post in.");
      return;
    }
    try {
      await purgeOwnPanels(channel, ButtonId.GiveawayScore);
      await channel.send({ embeds: [embed], components: [row] });
      await safeEditReply(interaction, `Round #${round.id} open in ${channel}.`);
    } catch (err) {
      logger.error("Giveaway panel post failed", { error: String(err) });
      await safeEditReply(
        interaction,
        `Round #${round.id} opened but the panel failed: ${(err as Error).message}`,
      );
    }
  }

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
    name: "giveaway-end",
    description: "Close the round, pick winners and pay them",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async end(interaction: CommandInteraction) {
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

    // Role exclusion reads the member cache; a cold cache would silently let
    // excluded roles back into the draw.
    await guild.members.fetch().catch(() => null);
    const winners = await GiveawayService.endRound(round, guild);
    if (!winners.length) {
      await safeEditReply(interaction, `Round #${round.id} closed with no participants.`);
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const embed = new EmbedBuilder()
      .setTitle(`🎉 Giveaway results - round #${round.id}`)
      .setDescription(
        [
          ...winners.map((w) => {
            const icon = w.kind === "ranked" ? (medals[w.place - 1] ?? "🏅") : "🎲";
            const tail = w.kind === "ranked" ? "" : " *(random draw)*";
            return `${icon} <@${w.memberId}> - **${GiveawayService.formatPrize(w.dollars)}** - ${w.score} pts${tail}\n> ${GiveawayService.formatBreakdown(w.breakdown)}`;
          }),
          "",
          `Top ${GIVEAWAY_RANKED_COUNT} placed by points; the rest were drawn at random from everyone who scored.`,
          "A new round opens soon - everything you already do counts toward it.",
        ].join("\n"),
      )
      .setColor(PURPLE)
      .setTimestamp(new Date());

    const channel =
      findTextChannel(guild, GIVEAWAY_ANNOUNCE_CHANNEL) ??
      (interaction.channel as TextChannel | null);
    await channel
      ?.send({ embeds: [embed], allowedMentions: { users: [] } })
      .catch((e) => logger.error("Giveaway results post failed", { error: String(e) }));

    const unpaid = winners.filter((w) => !w.paid);
    await safeEditReply(
      interaction,
      `Round #${round.id} closed. ${winners.length} winners paid.${unpaid.length ? ` ${unpaid.length} need a manual grant.` : ""}`,
    );
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
}
