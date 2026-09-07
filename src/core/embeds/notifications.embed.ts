import { BOT_NAME, GREEN_COLOR } from "@/shared/config/branding";
import { ButtonIdBuilder } from "@/types/custom-ids";
import {
  DM_SOURCE_LABEL,
  DM_TOGGLEABLE_SOURCES,
  type GrantSourceType,
} from "@/types";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
} from "discord.js";

const BUTTONS_PER_ROW = 5;

// Ephemeral reward-DM preference panel: one button per toggleable event, green
// (Success) when its DM is ON, grey (Secondary) when muted. optOuts is the set
// of sources the member has muted.
export function notificationsPanel(optOuts: Set<GrantSourceType>): {
  embeds: APIEmbed[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const lines = DM_TOGGLEABLE_SOURCES.map((source) => {
    const on = !optOuts.has(source);
    return `${on ? "🟢" : "⚪"} **${DM_SOURCE_LABEL[source]}** - DM ${on ? "on" : "off"}`;
  });

  const embed: APIEmbed = {
    color: GREEN_COLOR,
    title: "Reward DM notifications",
    description: `Toggle the direct messages ${BOT_NAME} sends you when you earn a reward. Green = on, grey = off. These only affect the DM; rewards still land on your balance.\n\n${lines.join("\n")}`,
  };

  const buttons = DM_TOGGLEABLE_SOURCES.map((source) =>
    new ButtonBuilder()
      .setCustomId(ButtonIdBuilder.dmToggle(source))
      .setLabel(DM_SOURCE_LABEL[source])
      .setStyle(
        optOuts.has(source) ? ButtonStyle.Secondary : ButtonStyle.Success,
      ),
  );

  // Discord rejects the whole payload if a row holds more than 5 buttons.
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buttons.slice(i, i + BUTTONS_PER_ROW),
      ),
    );
  }

  return { embeds: [embed], components: rows };
}
