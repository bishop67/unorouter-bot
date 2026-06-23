// Branding and visual constants (env-driven so the bot is brand-agnostic)

export const BOT_NAME = process.env.BOT_NAME?.trim() || "unorouter";
export const WEBSITE_URL =
  process.env.WEBSITE_URL?.trim() || "https://unorouter.com";

export const RED_COLOR = 0xff0000;
export const GREEN_COLOR = 0x57f287;

// Trigger the AI when a message starts with the bot's name (e.g. "<BOT_NAME> help me").
// null when BOT_NAME is empty so callers can skip the replace.
export const NAME_TRIGGER_PATTERN: RegExp | null = BOT_NAME
  ? new RegExp(`^${escapeRegex(BOT_NAME)}\\b\\s*`, "i")
  : null;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
