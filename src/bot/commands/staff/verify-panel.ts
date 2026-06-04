import {
  isStaff,
  purgeOwnPanels,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { BOT_NAME, WEBSITE_URL } from "@/shared/config/branding";
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
export class VerifyPanelCommand {
  @Slash({
    name: "verify-panel",
    description: "Post the verify-and-claim panel in this channel",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  })
  async verifyPanel(interaction: CommandInteraction) {
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

    const settingsLink = `${WEBSITE_URL}/settings?redirect=/settings`;

    const embed = new EmbedBuilder()
      .setTitle(`Link your ${BOT_NAME} account`)
      .setDescription(
        [
          `Connect your Discord to your ${BOT_NAME} account to unlock the linked role and claim your one-time welcome bonus.`,
          "",
          `**How:** [connect Discord in your account settings](${settingsLink}), then click the button below.`,
        ].join("\n"),
      )
      .setColor(0x9b59ff);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonId.ClaimConnect)
        .setLabel("Verify & Claim")
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Success),
    );

    try {
      await purgeOwnPanels(channel as TextChannel, ButtonId.ClaimConnect);
      await (channel as TextChannel).send({ embeds: [embed], components: [row] });
      await safeEditReply(interaction, "Verify panel posted.");
    } catch (err) {
      await safeEditReply(
        interaction,
        `Could not post the panel: ${(err as Error).message}. Make sure I can View + Send Messages here.`,
      );
    }
  }
}
