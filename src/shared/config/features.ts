// Feature flags parsed from environment variables

// Leveling is ON by default; set SHOULD_USER_LEVEL_UP=false to disable.
export const SHOULD_USER_LEVEL_UP =
  process.env.SHOULD_USER_LEVEL_UP?.trim() !== "false";

// Bot user IDs whose messages are deleted on sight (comma-separated), for
// third-party bots that spam notices we cannot disable (e.g. CommunityOne).
export const PURGE_BOT_USER_IDS = new Set(
  process.env.PURGE_BOT_USER_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [],
);
