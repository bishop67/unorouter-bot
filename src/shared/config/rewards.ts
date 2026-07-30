import { LEVEL_LIST } from "./levels";

// Payout amounts in DOLLARS. This module is the ONE place the reward env vars are
// read; services and panels import from here rather than parsing their own copy,
// so `GET /rewards` can never disagree with what the bot actually pays.
export const REWARDS = {
  connect: parseFloat(process.env.CONNECT_GRANT_DOLLARS || "0"),
  vote: parseFloat(process.env.VOTE_GRANT_DOLLARS || "0"),
  boost: parseFloat(process.env.BOOST_GRANT_DOLLARS || "0"),
  invite: parseFloat(process.env.INVITE_GRANT_DOLLARS || "0.01"),
  serverTag: parseFloat(process.env.SERVER_TAG_GRANT_DOLLARS || "0"),
};

// new-api default QuotaPerUnit = 500000 quota = $1.
export const QUOTA_PER_DOLLAR = parseInt(
  process.env.QUOTA_PER_DOLLAR || "500000",
  10,
);

export function dollarsToQuota(dollars: number): number {
  return Math.round(dollars * QUOTA_PER_DOLLAR);
}

// Keeps the cents pair a price is expected to have (0.50, not 0.5) while still
// showing a third decimal when the amount has one (0.025, not a rounded 0.03).
export function formatDollars(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 3,
  }).format(dollars);
}

// Raw numbers only: consumers localize them (the website formats per locale, so
// a pre-formatted en-US string would be wrong in 17 of 18 languages).
export function rewardsPayload() {
  const levels = LEVEL_LIST.map((level) => ({
    tier: level.tier,
    role: level.role,
    messages: level.count,
    dollars: level.dollars,
  }));
  return {
    quotaPerDollar: QUOTA_PER_DOLLAR,
    amounts: { ...REWARDS },
    levels,
    levelTotal: levels.reduce((sum, level) => sum + level.dollars, 0),
  };
}
