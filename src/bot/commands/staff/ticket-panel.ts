import {
  isStaff,
  purgeOwnPanels,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { BOT_NAME } from "@/shared/config/branding";
import { ButtonId } from "@/types/custom-ids";
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

@Discord()
export class TicketPanelCommand {
  @Slash({
    name: "ticket-panel",
    description: "Post the ticket panel in this channel",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  })
  async ticketPanel(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
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

    const embed = new EmbedBuilder()
      .setTitle(`${BOT_NAME} Support`)
      .setDescription(
        "Need help or found a bug? Open a private ticket and the team will get back to you.",
      )
      .setColor(0x5865f2);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonId.TicketOpenSupport)
        .setLabel("Open Ticket")
        .setEmoji("🎫")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(ButtonId.TicketOpenBug)
        .setLabel("Report a Bug")
        .setEmoji("🐞")
        .setStyle(ButtonStyle.Secondary),
    );

    try {
      await purgeOwnPanels(channel as TextChannel, ButtonId.TicketOpenSupport);
      await (channel as TextChannel).send({ embeds: [embed], components: [row] });
      await safeEditReply(interaction, "Ticket panel posted.");
    } catch (err) {
      await safeEditReply(
        interaction,
        `Could not post the panel: ${(err as Error).message}. Make sure I can View + Send Messages here.`,
      );
    }
  }
}
