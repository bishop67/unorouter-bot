import type { APIEmbed, User } from "discord.js";

// Discord's own palette, so a join and a ban read differently at a glance.
export const LOG_COLORS = {
  positive: 0x57f287, // unjailed, unbanned, timeout lifted
  negative: 0xed4245, // kicked, banned, jailed, deleted
  caution: 0xfee75c, // warned, timed out
  neutral: 0x5865f2,
} as const;

export type LogTone = keyof typeof LOG_COLORS;

export function logEmbed(params: {
  tone: LogTone;
  /** Bold first line: the thing that happened. */
  title: string;
  /** Puts the member's face on the entry, which is what makes a log skimmable. */
  user?: User | null;
  lines?: (string | null | undefined)[];
  footer: string;
}): APIEmbed {
  const body = (params.lines ?? []).filter(
    (line): line is string => typeof line === "string" && line.length > 0,
  );

  return {
    color: LOG_COLORS[params.tone],
    author: params.user
      ? {
          name: params.user.username,
          icon_url: params.user.displayAvatarURL(),
        }
      : undefined,
    description: [`**${params.title}**`, ...body].join("\n"),
    timestamp: new Date().toISOString(),
    footer: { text: params.footer },
  };
}
