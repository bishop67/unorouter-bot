import { APIEmbed } from "discord.js";
import { BOT_NAME, GREEN_COLOR, WEBSITE_URL } from "@/shared/config/branding";

function placement(i: number): string {
  const medals = ["🥇", "🥈", "🥉"];
  return medals[i] ?? `\`#${i + 1}\``;
}

export function topStatsEmbed(params: {
  lookback: number;
  topUsers: Array<{ memberId: string; count: number }>;
  topInviters: Array<{ memberId: string; count: number }>;
}): APIEmbed {
  const fmt = (n: number) => n.toLocaleString("en");

  const userSum = params.topUsers.reduce((a, b) => a + b.count, 0);
  const inviteSum = params.topInviters.reduce((a, b) => a + b.count, 0);

  const usersBlock = params.topUsers.length
    ? params.topUsers
        .map(
          (u, i) =>
            `${placement(i)} <@${u.memberId}> \`${fmt(u.count)} messages\``,
        )
        .join("\n")
    : "_No messages tracked yet._";

  const invitersBlock = params.topInviters.length
    ? params.topInviters
        .map(
          (u, i) =>
            `${placement(i)} <@${u.memberId}> \`${fmt(u.count)} invites\``,
        )
        .join("\n")
    : "_No invites tracked yet._";

  const window =
    params.lookback >= 9999 ? "all time" : `the past ${params.lookback} days`;

  return {
    color: GREEN_COLOR,
    title: "⭐ Top Stats Overview",
    description: [
      `Top members and inviters over __${window}__.`,
      "",
      `**Members | Top ${params.topUsers.length}**`,
      `Total: \`${fmt(userSum)} messages\``,
      "",
      usersBlock,
      "",
      `**Inviters | Top ${params.topInviters.length}**`,
      `Total: \`${fmt(inviteSum)} invites\``,
      "",
      invitersBlock,
    ].join("\n"),
    timestamp: new Date().toISOString(),
    footer: {
      text: `${BOT_NAME} - ${WEBSITE_URL.replace(/^https?:\/\//, "")}`,
    },
  };
}
