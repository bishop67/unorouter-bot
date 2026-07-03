// Core/Required environment variables
interface CoreBotEnvironment {
  TOKEN: string;
  DATABASE_URL?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  POSTGRES_HOST?: string;
  POSTGRES_DB?: string;
  GUILD_IDS?: string;
}

// Feature-specific environment variables
interface FeatureBotEnvironment {
  // AI features
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  KLIPY_API_KEY: string;

  // Role system
  STAFF_ROLES: string;
  STATUS_ROLES: string;
  LEVEL_ROLES: string;

  // Tickets + bug reports (channel NAMES / slugs, matched by substring)
  TICKET_CATEGORY: string;
  TICKET_LOG_CHANNEL: string;
  BUG_REPORT_FORUM_CHANNEL: string;

  // Grants (new-api integration)
  NEW_API_URL: string;
  NEW_API_ADMIN_TOKEN: string;
  NEW_API_USER_ID: string;
  GRANT_LOG_CHANNEL: string;
  BOOST_CHANNEL: string;
  // Bonus amounts in DOLLARS; bot converts via QUOTA_PER_DOLLAR (default 500000).
  QUOTA_PER_DOLLAR: string;
  BOOST_GRANT_DOLLARS: string;
  CONNECT_GRANT_DOLLARS: string;
  CONNECTED_ROLE: string;

  // Moderation: comma-separated bot user IDs whose messages get deleted on sight
  PURGE_BOT_USER_IDS: string;

  // Branding
  BOT_NAME: string;
  WEBSITE_URL: string;
  BOT_ACTIVITY: string;
}

interface BotEnvironment extends CoreBotEnvironment, FeatureBotEnvironment {}

declare namespace NodeJS {
  export interface ProcessEnv extends BotEnvironment {}
}
