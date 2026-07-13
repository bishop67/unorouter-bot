import { notificationsPanel } from "@/core/embeds/notifications.embed";
import { DmPreferenceService } from "@/core/services/notifications/dm-preference.service";
import { logger } from "@/lib/logger";
import { isDmToggleable, type GrantSourceType } from "@/types";
import { ButtonIdPattern, ButtonIdPrefix } from "@/types/custom-ids";
import {
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { ButtonComponent, Discord, Slash } from "discordx";

@Discord()
export class NotificationsCommand {
  @Slash({
    name: "notifications",
    description: "Manage the reward DMs the bot sends you",
    dmPermission: false,
  })
  async notifications(interaction: CommandInteraction) {
    const optOuts = await DmPreferenceService.getOptOuts(interaction.user.id);
    await interaction.reply({
      ...notificationsPanel(optOuts),
      flags: [MessageFlags.Ephemeral],
    });
  }

  @ButtonComponent({ id: ButtonIdPattern.DmToggle })
  async toggle(interaction: ButtonInteraction) {
    const source = interaction.customId.slice(
      `${ButtonIdPrefix.DmToggle}:`.length,
    ) as GrantSourceType;
    if (!isDmToggleable(source)) {
      await interaction.deferUpdate();
      return;
    }

    await DmPreferenceService.toggle(interaction.user.id, source).catch((e) =>
      logger.error("DM toggle failed", {
        member: interaction.user.id,
        source,
        error: String(e),
      }),
    );

    const optOuts = await DmPreferenceService.getOptOuts(interaction.user.id);
    // Re-render the same ephemeral message so the button colour flips in place.
    await interaction.update(notificationsPanel(optOuts));
  }
}
