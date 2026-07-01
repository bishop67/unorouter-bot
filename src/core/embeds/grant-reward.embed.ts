import { APIEmbed } from "discord.js";
import { BOT_NAME, GREEN_COLOR, WEBSITE_URL } from "@/shared/config/branding";
import { type GrantSourceType } from "@/types";

type RewardCopy = { title: string; intro: string };

// Per-source DM copy. Keep the voting line only where a re-vote cadence applies.
// The vote intro is templated with the real site (grantRewardEmbed fills it in);
// the fallback below is only used if no site label was passed.
const COPY: Record<GrantSourceType, RewardCopy> = {
  vote: { title: "Vote Reward!", intro: "Thanks for voting for us!" },
  connect: { title: "Account Linked!", intro: "Thanks for linking your Discord account." },
  boost: { title: "Boost Reward!", intro: "Thanks for boosting the server!" },
  bug: { title: "Bug Bounty Reward!", intro: "Thanks for the bug report." },
  ticket: { title: "Reward Granted!", intro: "A reward was added from your ticket." },
  command: { title: "Reward Granted!", intro: "A reward was added to your account." },
};

export function grantRewardEmbed(params: {
  sourceType: GrantSourceType;
  addedDollars: number;
  totalDollars: number | null;
  voteAgainHours?: number;
  voteSiteLabel?: string;
}): APIEmbed {
  const copy = COPY[params.sourceType] ?? COPY.command;
  const fmt = (n: number) =>
    Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;

  const intro =
    params.sourceType === "vote" && params.voteSiteLabel
      ? `Thanks for voting for us on ${params.voteSiteLabel}!`
      : copy.intro;

  const lines = [
    intro,
    "",
    `**+${fmt(params.addedDollars)}** added to your balance.`,
  ];
  if (params.totalDollars !== null) {
    lines.push(`**Total balance:** ${fmt(params.totalDollars)}`);
  }
  if (params.voteAgainHours) {
    lines.push("", `Vote again in **${params.voteAgainHours} hours** for another reward!`);
  }

  return {
    color: GREEN_COLOR,
    title: copy.title,
    description: lines.join("\n"),
    timestamp: new Date().toISOString(),
    footer: { text: `${BOT_NAME} - ${WEBSITE_URL.replace(/^https?:\/\//, "")}` },
  };
}
