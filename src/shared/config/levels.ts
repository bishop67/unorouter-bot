import { LEVEL_ROLES } from "./roles";

// Message-count threshold per level tier, low -> high. Mapped positionally onto
// LEVEL_ROLES (LEVEL_ROLES[0] is the entry tier).
const LEVEL_THRESHOLDS = [10, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000];

// Balance granted on reaching each tier, in DOLLARS, positional to LEVEL_ROLES.
// Blank or short list => those tiers pay nothing.
const LEVEL_GRANT_DOLLARS = (process.env.LEVEL_GRANT_DOLLARS || "")
  .split(",")
  .map((s) => parseFloat(s.trim()));

export const LEVEL_LIST = LEVEL_ROLES.map((role, i) => ({
  count: LEVEL_THRESHOLDS[i] ?? (i + 1) * 10000,
  role,
  tier: i,
  dollars: Number.isFinite(LEVEL_GRANT_DOLLARS[i]) ? LEVEL_GRANT_DOLLARS[i]! : 0,
}));

export function levelUpMessage(
  userMention: string,
  roleMention: string,
): string {
  return `${userMention} leveled up to ${roleMention}!`;
}
