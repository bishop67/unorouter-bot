import { db } from "@/lib/db";
import { grantLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { BOT_NAME, WEBSITE_URL } from "@/shared/config/branding";
import { findTextChannel } from "@/shared/utils/channel.utils";
import { bot } from "@/main";
import { GRANT_SOURCE_LABEL, type GrantResult, type GrantSourceType } from "@/types";
import { and, eq } from "drizzle-orm";
import {
  type Guild,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";

const NEW_API_URL = process.env.NEW_API_URL?.replace(/\/$/, "") || "";
const NEW_API_ADMIN_TOKEN = process.env.NEW_API_ADMIN_TOKEN || "";
// new-api admin auth requires BOTH the access token (Authorization) and the matching
// user id (New-Api-User header). The system access token belongs to user id 1.
const NEW_API_USER_ID = process.env.NEW_API_USER_ID?.trim() || "1";
// Channels resolved by NAME (substring) so emoji renames don't break config.
const GRANT_LOG_CHANNEL_NAME =
  process.env.GRANT_LOG_CHANNEL?.trim() || "grants-log";
const BOOST_CHANNEL_NAME = process.env.BOOST_CHANNEL?.trim() || "boosters";

// Bonuses are configured in DOLLARS; bot converts to new-api quota units.
// new-api default QuotaPerUnit = 500000 quota = $1.
const QUOTA_PER_DOLLAR = parseInt(
  process.env.QUOTA_PER_DOLLAR || "500000",
  10,
);
export function dollarsToQuota(dollars: number): number {
  return Math.round(dollars * QUOTA_PER_DOLLAR);
}
const BOOST_GRANT_DOLLARS = parseFloat(process.env.BOOST_GRANT_DOLLARS || "0");
const BOOST_GRANT_QUOTA = dollarsToQuota(BOOST_GRANT_DOLLARS);
const CONNECT_GRANT_QUOTA = dollarsToQuota(
  parseFloat(process.env.CONNECT_GRANT_DOLLARS || "0"),
);
// Role given when a user proves their Discord is linked to the platform.
const CONNECTED_ROLE = process.env.CONNECTED_ROLE?.trim() || BOT_NAME;

const CONNECT_GRANT_DOLLARS = parseFloat(
  process.env.CONNECT_GRANT_DOLLARS || "0",
);

export type ConnectResult =
  | { status: "not_linked" }
  | { status: "connected"; bonusGranted: boolean; dollars: number };

export class GrantService {
  static isConfigured(): boolean {
    return Boolean(NEW_API_URL && NEW_API_ADMIN_TOKEN);
  }

  /**
   * Grant quota to whoever has linked this Discord ID on the platform.
   * Repeatable: every successful grant is appended to grantLog (audit, not a lock).
   * Returns { linked:false } when the Discord account is not linked.
   */
  static async grantQuota(params: {
    targetDiscordId: string;
    quota: number;
    reason: string;
    sourceType: GrantSourceType;
    sourceId?: string | null;
    grantedByDiscordId: string;
  }): Promise<GrantResult> {
    if (!this.isConfigured()) {
      logger.warn("Grant skipped: NEW_API_URL / NEW_API_ADMIN_TOKEN missing");
      return { linked: false, quota: params.quota };
    }
    if (params.quota <= 0) {
      throw new Error("Grant quota must be positive");
    }

    const res = await fetch(`${NEW_API_URL}/api/user/discord_grant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: NEW_API_ADMIN_TOKEN,
        "New-Api-User": NEW_API_USER_ID,
      },
      body: JSON.stringify({
        discord_id: params.targetDiscordId,
        quota: params.quota,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("Grant request failed", {
        status: res.status,
        body: text.slice(0, 300),
      });
      throw new Error(`new-api grant failed (${res.status})`);
    }

    const json = (await res.json()) as {
      success?: boolean;
      message?: string;
      data?: { user_id?: number; linked?: boolean };
    };

    if (json.success === false) {
      throw new Error(json.message || "new-api grant rejected");
    }

    const linked = json.data?.linked ?? false;
    if (!linked) {
      return { linked: false, quota: params.quota };
    }

    const userId = json.data?.user_id;
    await db
      .insert(grantLog)
      .values({
        targetDiscordId: params.targetDiscordId,
        newApiUserId: userId ?? null,
        quota: params.quota,
        reason: params.reason,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        grantedByDiscordId: params.grantedByDiscordId,
      })
      .catch((e) => logger.error("grantLog insert failed", { error: String(e) }));

    await this.announce(
      params.targetDiscordId,
      params.quota,
      params.reason,
      params.sourceType,
    );

    return { linked: true, userId, quota: params.quota };
  }

  static linkPrompt(): string {
    return `You need to [link your Discord account](${WEBSITE_URL}/settings?redirect=/settings) first - then try again.`;
  }

  /**
   * One-time connect flow for the claim panel. Verifies the member's Discord is
   * linked to the platform. First successful verify grants a one-time connect bonus
   * (recorded as sourceType="connect") and adds the connected role. Repeat clicks
   * only ensure the role - no second bonus.
   */
  static async connectBonus(member: GuildMember): Promise<ConnectResult> {
    if (!this.isConfigured()) return { status: "not_linked" };

    const prior = await db.query.grantLog
      .findFirst({
        where: and(
          eq(grantLog.targetDiscordId, member.id),
          eq(grantLog.sourceType, "connect"),
        ),
      })
      .catch(() => null);

    if (prior) {
      // Already claimed once: they were linked before. Just ensure the role.
      await this.ensureConnectedRole(member);
      return { status: "connected", bonusGranted: false, dollars: 0 };
    }

    const quota = CONNECT_GRANT_QUOTA;
    const result = await this.grantQuota({
      targetDiscordId: member.id,
      quota: quota > 0 ? quota : 1, // endpoint requires > 0; min 1 just verifies the link
      reason: "discord connect bonus",
      sourceType: "connect",
      sourceId: null,
      grantedByDiscordId: "system",
    }).catch(() => ({ linked: false, quota }) as GrantResult);

    if (!result.linked) return { status: "not_linked" };

    await this.ensureConnectedRole(member);
    return {
      status: "connected",
      bonusGranted: quota > 0,
      dollars: CONNECT_GRANT_DOLLARS,
    };
  }

  private static async ensureConnectedRole(member: GuildMember): Promise<void> {
    const role = member.guild.roles.cache.find((r) => r.name === CONNECTED_ROLE);
    if (!role || !role.editable) return;
    if (member.roles.cache.has(role.id)) return;
    await member.roles
      .add(role, `Discord linked to ${BOT_NAME}`)
      .catch((e) =>
        logger.error("Connected role add failed", {
          member: member.id,
          error: String(e),
        }),
      );
  }

  private static async announce(
    targetDiscordId: string,
    quota: number,
    reason: string,
    sourceType: GrantSourceType,
  ): Promise<void> {
    const guild = bot.guilds.cache.first();
    if (!guild) return;
    const channel = findTextChannel(guild, GRANT_LOG_CHANNEL_NAME);
    if (!channel) return;
    const dollars = QUOTA_PER_DOLLAR > 0 ? quota / QUOTA_PER_DOLLAR : 0;
    const dollarLabel = Number.isInteger(dollars)
      ? `$${dollars}`
      : `$${dollars.toFixed(2)}`;
    const tag = GRANT_SOURCE_LABEL[sourceType] ?? sourceType;
    await channel
      .send({
        content: `\`[${tag}]\` Granted **${dollarLabel}** (${quota} quota) to <@${targetDiscordId}> - ${reason}`,
        allowedMentions: { users: [], roles: [] },
      })
      .catch((e) => logger.error("Grant announce failed", { error: String(e) }));
  }

  /**
   * Server boost auto-grant. Fires when premiumSince transitions null -> set.
   */
  static async handleBoost(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const startedBoosting = !oldMember.premiumSince && !!newMember.premiumSince;
    if (!startedBoosting) return;
    if (BOOST_GRANT_QUOTA <= 0 || !this.isConfigured()) return;

    try {
      const result = await this.grantQuota({
        targetDiscordId: newMember.id,
        quota: BOOST_GRANT_QUOTA,
        reason: "server boost",
        sourceType: "boost",
        sourceId: null,
        grantedByDiscordId: "system",
      });

      if (result.linked) {
        await this.postBoostChannel(
          newMember.guild,
          `${newMember} boosted the server and earned **$${BOOST_GRANT_DOLLARS}** balance. Thank you!`,
        );
      } else {
        await newMember
          .send(
            `Thanks for boosting! ${this.linkPrompt()} Once linked, ping a mod to receive your boost reward.`,
          )
          .catch(() => {});
        await this.postBoostChannel(
          newMember.guild,
          `${newMember} boosted the server! Link your Discord on ${WEBSITE_URL} to claim your boost reward.`,
        );
      }
    } catch (e) {
      logger.error("Boost grant failed", { error: String(e) });
    }
  }

  private static async postBoostChannel(
    guild: Guild,
    content: string,
  ): Promise<void> {
    const channel = findTextChannel(guild, BOOST_CHANNEL_NAME);
    if (!channel) return;
    await channel
      .send({ content, allowedMentions: { users: [] } })
      .catch((e) =>
        logger.error("Boost channel post failed", { error: String(e) }),
      );
  }
}
