// Role configurations parsed from environment variables

export const STAFF_ROLES =
  process.env.STAFF_ROLES?.split(",").map((s) => s.trim()) || [];

export const STATUS_ROLES =
  process.env.STATUS_ROLES?.split(",").map((s) => s.trim()) || [];

export const LEVEL_ROLES =
  process.env.LEVEL_ROLES?.split(",").map((s) => s.trim()) || [];

export const EVERYONE = "@everyone";

// Age-group roles that count as adult (self-assigned via onboarding customize).
export const ADULT_AGE_ROLES = process.env.ADULT_AGE_ROLES?.split(",").map((s) =>
  s.trim(),
) || ["Age 18-24", "Age 25+"];

// Role name that unlocks the restricted channel. Granted only when a member holds
// both an adult age role AND the connected role; removed when either is lost.
export const ADULT_ROLE = process.env.ADULT_ROLE?.trim() || "18+ Verified";

// Connected/verified role: proves the Discord account is linked to the platform.
export const CONNECTED_ROLE =
  process.env.CONNECTED_ROLE?.trim() || process.env.BOT_NAME?.trim() || "";

// Status role names (by convention: Verified, Jail)
export const VERIFIED =
  STATUS_ROLES.find((r) => r?.toLowerCase() === "verified") ||
  STATUS_ROLES?.[0];

export const JAIL =
  STATUS_ROLES.find((r) => r?.toLowerCase() === "jail") || STATUS_ROLES?.[1];
