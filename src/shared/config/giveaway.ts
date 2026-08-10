// Weekly giveaway. Prizes in DOLLARS, high to low; the first
// GIVEAWAY_RANKED_COUNT go to the top scorers and the rest are drawn at random
// among the other participants, so the round rewards the regulars without
// leaving everyone else with no reason to take part.
const PRIZES = (process.env.GIVEAWAY_PRIZES || "2,1,0.50,0.25,0.10")
  .split(",")
  .map((part) => parseFloat(part.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

export const GIVEAWAY_PRIZES = PRIZES;

export const GIVEAWAY_RANKED_COUNT = Math.min(
  parseInt(process.env.GIVEAWAY_RANKED_COUNT || "3", 10),
  PRIZES.length,
);

export const GIVEAWAY_ENABLED = PRIZES.length > 0;

/**
 * Points per signal.
 *
 * Tag and boost outrank a vote on purpose: both are standing commitments that
 * cost the member something, and tag skews heavily toward members who never
 * post, who would otherwise have no way to place.
 */
export const GIVEAWAY_WEIGHTS = {
  invite: parseInt(process.env.GIVEAWAY_POINTS_INVITE || "10", 10),
  boost: parseInt(process.env.GIVEAWAY_POINTS_BOOST || "8", 10),
  serverTag: parseInt(process.env.GIVEAWAY_POINTS_TAG || "8", 10),
  level: parseInt(process.env.GIVEAWAY_POINTS_LEVEL || "5", 10),
  vote: parseInt(process.env.GIVEAWAY_POINTS_VOTE || "3", 10),
  message: parseInt(process.env.GIVEAWAY_POINTS_MESSAGE || "1", 10),
};

export type GiveawaySignal = keyof typeof GIVEAWAY_WEIGHTS;

/**
 * Most points any ONE signal can contribute to a round. 0 means uncapped.
 *
 * Load-bearing: invites and votes have no natural rate limit. The server's top
 * recruiter sustains 9-18 invites EVERY DAY, which uncapped is ~900 points a
 * round against ~165 for the best voter - they would win first place forever and
 * nobody else would bother entering. Caps keep a strong week strong without
 * letting a single signal decide the round.
 */
export const GIVEAWAY_CAPS: Record<GiveawaySignal, number> = {
  invite: parseInt(process.env.GIVEAWAY_CAP_INVITE || "50", 10),
  boost: parseInt(process.env.GIVEAWAY_CAP_BOOST || "0", 10),
  serverTag: parseInt(process.env.GIVEAWAY_CAP_TAG || "0", 10),
  level: parseInt(process.env.GIVEAWAY_CAP_LEVEL || "0", 10),
  vote: parseInt(process.env.GIVEAWAY_CAP_VOTE || "40", 10),
  message: parseInt(process.env.GIVEAWAY_CAP_MESSAGE || "30", 10),
};

export function capPoints(signal: GiveawaySignal, points: number): number {
  const cap = GIVEAWAY_CAPS[signal];
  return cap > 0 ? Math.min(points, cap) : points;
}

// Messages shorter than this do not score. Raw message count collapses into
// one-word farming otherwise.
export const GIVEAWAY_MIN_MESSAGE_LENGTH = parseInt(
  process.env.GIVEAWAY_MIN_MESSAGE_LENGTH || "10",
  10,
);

// At most one scoring message per member per this many seconds.
export const GIVEAWAY_MESSAGE_COOLDOWN_SECONDS = parseInt(
  process.env.GIVEAWAY_MESSAGE_COOLDOWN_SECONDS || "60",
  10,
);

// Channel NAME substrings whose messages never score (bot spam, AI chat).
export const GIVEAWAY_EXCLUDED_CHANNELS = (
  process.env.GIVEAWAY_EXCLUDED_CHANNELS || "bot-commands,spicy"
)
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

// Rounds run on a fixed clock and roll straight into the next one, so the
// giveaway is always live and members never land on a dead panel.
export const GIVEAWAY_ROUND_DAYS = parseInt(
  process.env.GIVEAWAY_ROUND_DAYS || "7",
  10,
);

export const GIVEAWAY_AUTO_REPEAT =
  process.env.GIVEAWAY_AUTO_REPEAT?.trim() !== "false";

export const GIVEAWAY_CRON_INTERVAL_MS = parseInt(
  process.env.GIVEAWAY_CRON_INTERVAL_MS || "600000", // 10min
  10,
);

export const GIVEAWAY_ANNOUNCE_CHANNEL =
  process.env.GIVEAWAY_ANNOUNCE_CHANNEL?.trim() || "giveaway";

// One-off raffles (a promo code, a voucher), separate from the points round.
export const RAFFLE_DEFAULT_DURATION_HOURS = parseInt(
  process.env.RAFFLE_DEFAULT_DURATION_HOURS || "24",
  10,
);

// Upper bound on the duration parser, so a typo cannot open a raffle that never
// ends and blocks nothing but sits in the channel forever.
export const RAFFLE_MAX_DURATION_DAYS = parseInt(
  process.env.RAFFLE_MAX_DURATION_DAYS || "30",
  10,
);

// Role NAMES barred from scoring. Admins run the draw, so them placing reads as
// rigged however fair it was. Moderators and below still take part.
export const GIVEAWAY_EXCLUDED_ROLES = (
  process.env.GIVEAWAY_EXCLUDED_ROLES ?? "Admin"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
