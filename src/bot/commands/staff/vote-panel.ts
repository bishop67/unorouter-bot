import {
  isStaff,
  purgeOwnPanelsByTitle,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { BOT_NAME } from "@/shared/config/branding";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  CommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { Discord, Slash } from "discordx";

const PANEL_TITLE = "🗳️ Vote for us, get rewarded";

@Discord()
export class VotePanelCommand {
  @Slash({
    name: "vote-panel",
    description: "Post the vote-for-rewards panel in this channel",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  })
  async votePanel(interaction: CommandInteraction) {
    if (
      !(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] }))
    )
      return;

    if (!isStaff(interaction.member as GuildMember)) {
      await safeEditReply(interaction, "You are not allowed to use this command.");
      return;
    }

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await safeEditReply(interaction, "Run this in a text channel.");
      return;
    }

    const topggUrl = process.env.TOPGG_VOTE_URL?.trim();
    const discordsUrl = process.env.DISCORDS_VOTE_URL?.trim();
    const discadiaUrl = process.env.DISCADIA_VOTE_URL?.trim();
    const discordserversUrl = process.env.DISCORDSERVERS_VOTE_URL?.trim();
    if (!topggUrl && !discordsUrl && !discadiaUrl && !discordserversUrl) {
      await safeEditReply(
        interaction,
        "No vote URLs configured (set TOPGG_VOTE_URL / DISCORDS_VOTE_URL / DISCADIA_VOTE_URL / DISCORDSERVERS_VOTE_URL).",
      );
      return;
    }

    const dollars = parseFloat(process.env.VOTE_GRANT_DOLLARS || "0");
    const reward =
      dollars > 0
        ? `**$${formatDollars(dollars)}** balance`
        : "**free balance**";

    const extraLinks = [
      ["DiscordBotList", process.env.DISCORDBOTLIST_VOTE_URL?.trim()],
      ["Discord.me", process.env.DISCORDME_VOTE_URL?.trim()],
      ["Disboard", process.env.DISBOARD_VOTE_URL?.trim()],
      ["CommunityOne", process.env.COMMUNITYONE_VOTE_URL?.trim()],
      ["DiscordHome", process.env.DISCORDHOME_VOTE_URL?.trim()],
    ].filter(([, url]) => url) as [string, string][];

    const description = [
      `Upvote ${BOT_NAME} below and ${reward} lands automatically.`,
      `Each button pays every **12 hours**.`,
      "",
      `⚠️ Listing sites go down or skip a vote now and then, so a reward can miss. No action needed, just vote again next window and it lands.`,
    ];

    if (extraLinks.length) {
      description.push(
        "",
        `Also listed here (no balance, but upvotes/bumps help us rank):`,
        extraLinks.map(([name, url]) => `[${name}](${url})`).join("  |  "),
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(PANEL_TITLE)
      .setDescription(description.join("\n"))
      .setColor(0x9b59ff);

    const row = new ActionRowBuilder<ButtonBuilder>();
    if (topggUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Vote on Top.gg")
          .setEmoji("🗳️")
          .setStyle(ButtonStyle.Link)
          .setURL(topggUrl),
      );
    }
    if (discordsUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Vote on Discords.com")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Link)
          .setURL(discordsUrl),
      );
    }
    if (discadiaUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Vote on Discadia")
          .setEmoji("🚀")
          .setStyle(ButtonStyle.Link)
          .setURL(discadiaUrl),
      );
    }
    if (discordserversUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Vote on DiscordServers")
          .setEmoji("🌐")
          .setStyle(ButtonStyle.Link)
          .setURL(discordserversUrl),
      );
    }

    try {
      await purgeOwnPanelsByTitle(channel as TextChannel, PANEL_TITLE);
      await (channel as TextChannel).send({ embeds: [embed], components: [row] });
      await safeEditReply(interaction, "Vote panel posted.");
    } catch (err) {
      await safeEditReply(
        interaction,
        `Could not post the panel: ${(err as Error).message}. Make sure I can View + Send Messages here.`,
      );
    }
  }
}

function formatDollars(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(2);
}
