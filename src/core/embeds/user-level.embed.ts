import { APIEmbed } from "discord.js";
import { BOT_NAME, GREEN_COLOR, WEBSITE_URL } from "@/shared/config/branding";

const BAR_SLOTS = 12;

export function userLevelEmbed(params: {
  displayName: string;
  avatarUrl: string | null;
  messageCount: number;
  currentRole: string | null;
  nextRole: string | null;
  currentThreshold: number;
  nextThreshold: number | null;
}): APIEmbed {
  const fmt = (n: number) => n.toLocaleString("en");

  const lines = [
    `**Level:** ${params.currentRole ?? "No level yet"}`,
    `**Messages:** \`${fmt(params.messageCount)}\``,
  ];

  if (params.nextRole && params.nextThreshold !== null) {
    const span = params.nextThreshold - params.currentThreshold;
    const into = Math.min(params.messageCount - params.currentThreshold, span);
    const ratio = span > 0 ? Math.max(into / span, 0) : 1;
    const filled = Math.min(Math.round(ratio * BAR_SLOTS), BAR_SLOTS);
    const bar = "▰".repeat(filled) + "▱".repeat(BAR_SLOTS - filled);
    const remaining = Math.max(params.nextThreshold - params.messageCount, 0);
    lines.push(
      "",
      `**Next:** ${params.nextRole}`,
      `${bar} \`${fmt(params.messageCount)} / ${fmt(params.nextThreshold)}\``,
      `\`${fmt(remaining)}\` messages to go`,
    );
  } else if (params.currentRole) {
    lines.push("", "Max level reached!");
  }

  return {
    color: GREEN_COLOR,
    title: `${params.displayName}'s Level`,
    ...(params.avatarUrl ? { thumbnail: { url: params.avatarUrl } } : {}),
    description: lines.join("\n"),
    timestamp: new Date().toISOString(),
    footer: {
      text: `${BOT_NAME} - ${WEBSITE_URL.replace(/^https?:\/\//, "")}`,
    },
  };
}
