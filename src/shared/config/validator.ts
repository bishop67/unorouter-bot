/// <reference path="../../types/env.d.ts" />
import "@dotenvx/dotenvx/config";
import { log, warn } from "console";
interface ConfigCheck {
  key: keyof FeatureBotEnvironment;
  required: boolean;
  feature: string;
}

export class ConfigValidator {
  private static checks: ConfigCheck[] = [
    {
      key: "GOOGLE_GENERATIVE_AI_API_KEY",
      required: false,
      feature: "AI Chat & Spam Detection",
    },
    {
      key: "KLIPY_API_KEY",
      required: false,
      feature: "GIF Search",
    },
    {
      key: "STAFF_ROLES",
      required: false,
      feature: "Staff Commands (grant, tickets)",
    },
    {
      key: "STATUS_ROLES",
      required: false,
      feature: "Status Role Management (jail)",
    },
    {
      key: "LEVEL_ROLES",
      required: false,
      feature: "Level Up System",
    },
    {
      key: "TICKET_CATEGORY",
      required: false,
      feature: "Ticket System",
    },
    {
      key: "BUG_REPORT_FORUM_CHANNEL",
      required: false,
      feature: "Bug Report Forum",
    },
    {
      key: "NEW_API_URL",
      required: false,
      feature: "Balance Grants (new-api)",
    },
    {
      key: "NEW_API_BOT_TOKEN",
      required: false,
      feature: "Balance Grants (new-api)",
    },
  ];

  public static validateConfig(): void {
    log("🔧 Checking bot configuration...");

    const missing = this.checks.filter((check) => {
      const value = process.env[check.key];
      return !value || value.trim() === "";
    });

    const configured = this.checks.filter((check) => {
      const value = process.env[check.key];
      return value && value.trim() !== "";
    });

    if (configured.length > 0) {
      log("✅ Configured features:");
      configured.forEach((check) => log(`   - ${check.feature}`));
    }

    if (missing.length > 0) {
      warn("⚠️  Features disabled due to missing configuration:");
      missing.forEach((check) => {
        warn(`   - ${check.feature} (missing ${check.key})`);
      });
      warn("   Check your .env file to enable these features.");
    }

    log(
      `📊 Configuration: ${configured.length}/${this.checks.length} features enabled\n`,
    );
  }

  public static isFeatureEnabled(envKey: keyof FeatureBotEnvironment): boolean {
    const value = process.env[envKey];
    return !!(value && value.trim() !== "");
  }

  public static logFeatureDisabled(
    feature: string,
    envKey: keyof FeatureBotEnvironment,
  ): void {
    warn(`⚠️  ${feature} disabled: ${envKey} not configured`);
  }
}
