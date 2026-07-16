// Role configurations parsed from environment variables

export const STAFF_ROLES =
  process.env.STAFF_ROLES?.split(",").map((s) => s.trim()) || [];

// Admin-tier roles (subset of staff). Defaults to the first staff role.
export const ADMIN_ROLES = process.env.ADMIN_ROLES?.split(",").map((s) =>
  s.trim(),
) ||
  (process.env.STAFF_ROLES?.split(",").map((s) => s.trim())?.[0]
    ? [process.env.STAFF_ROLES.split(",")[0]!.trim()]
    : []);

export const STATUS_ROLES =
  process.env.STATUS_ROLES?.split(",").map((s) => s.trim()) || [];

// Roles allowed to use /transfer (give own balance to another linked user).
export const TRANSFER_ROLES =
  process.env.TRANSFER_ROLES?.split(",").map((s) => s.trim()) || [];

// Discord user ids allowed to use the private /grant (mints new balance). Not
// role-based on purpose: not even admins may mint unless their id is listed.
export const GRANT_OWNER_IDS = process.env.GRANT_OWNER_IDS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean) || ["883310265972707328", "1302775229923332119"];

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
