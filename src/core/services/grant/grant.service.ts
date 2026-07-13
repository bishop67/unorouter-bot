import { db } from "@/lib/db";
import { member, rewardGrant } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { getUser, grantDiscordQuota } from "@/lib/new-api/openapi";
import { bot } from "@/main";
import { BOT_NAME, WEBSITE_URL } from "@/shared/config/branding";
import { grantRewardEmbed } from "@/core/embeds/grant-reward.embed";
import { DmPreferenceService } from "@/core/services/notifications/dm-preference.service";
import { findTextChannel } from "@/shared/utils/channel.utils";
import {
  GRANT_SOURCE_LABEL,
  VOTE_SITE_LABEL,
  VoteSite,
  type GrantResult,
  type GrantSourceType
} from "@/types";
import { type Guild, type GuildMember } from "discord.js";
import { and, eq } from "drizzle-orm";

// Auth headers (Authorization + New-Api-User) are injected by the orval mutator
// in src/lib/new-api/custom-fetch.ts; these two only gate isConfigured().
const NEW_API_URL = process.env.NEW_API_URL?.replace(/\/$/, "") || "";
const NEW_API_ADMIN_TOKEN = process.env.NEW_API_ADMIN_TOKEN || "";
// Channels resolved by NAME (substring) so emoji renames don't break config.
const GRANT_LOG_CHANNEL_NAME =
  process.env.GRANT_LOG_CHANNEL?.trim() || "grants-log";

// Bonuses are configured in DOLLARS; bot converts to new-api quota units.
// new-api default QuotaPerUnit = 500000 quota = $1.
const QUOTA_PER_DOLLAR = parseInt(process.env.QUOTA_PER_DOLLAR || "500000", 10);
export function dollarsToQuota(dollars: number): number {
  return Math.round(dollars * QUOTA_PER_DOLLAR);
}

// Automated grants pass the "system" sentinel; the normalized schema records the
// actor as a nullable member FK, so NULL means system.
function systemToNull(grantedBy: string): string | null {
  return grantedBy === "system" ? null : grantedBy;
}

const CONNECT_GRANT_QUOTA = dollarsToQuota(
  parseFloat(process.env.CONNECT_GRANT_DOLLARS || "0")
);
// Role given when a user proves their Discord is linked to the platform.
const CONNECTED_ROLE = process.env.CONNECTED_ROLE?.trim() || BOT_NAME;

const CONNECT_GRANT_DOLLARS = parseFloat(
  process.env.CONNECT_GRANT_DOLLARS || "0"
);

export const ConnectStatus = {
  NotLinked: "not_linked",
  Connected: "connected"
} as const;
export type ConnectStatus = (typeof ConnectStatus)[keyof typeof ConnectStatus];

export type ConnectResult =
  | { status: typeof ConnectStatus.NotLinked }
  | {
      status: typeof ConnectStatus.Connected;
      bonusGranted: boolean;
      dollars: number;
    };

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

    const res = await grantDiscordQuota({
      discord_id: params.targetDiscordId,
      quota: params.quota
    }).catch((e: { status?: number; data?: unknown }) => {
      logger.error("Grant request failed", { status: e.status, body: e.data });
      throw new Error(`new-api grant failed (${e.status ?? "?"})`);
    });

    const json = res.data;
    if (json.success === false) {
      throw new Error(json.message || "new-api grant rejected");
    }

    if (!json.data.linked) {
      return { linked: false, quota: params.quota };
    }

    const userId = json.data.user_id;
    // reward_grants.target_member_id FKs to members. The recipient is linked on
    // the platform but may never have been seen by the bot as a guild member
    // (e.g. voted via webhook while uncached), so ensure a member row exists.
    // A real profile fills in on their next guild event.
    await db
      .insert(member)
      .values({ memberId: params.targetDiscordId, username: params.targetDiscordId })
      .onConflictDoNothing();

    await db
      .insert(rewardGrant)
      .values({
        targetMemberId: params.targetDiscordId,
        newApiUserId: userId ?? null,
        quota: params.quota,
        reason: params.reason,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        grantedByMemberId: systemToNull(params.grantedByDiscordId)
      })
      .catch((e) =>
        logger.error("reward grant insert failed", { error: String(e) })
      );

    await this.announce(
      params.targetDiscordId,
      params.quota,
      params.reason,
      params.sourceType,
      userId
    );

    await this.dmReward(
      params.targetDiscordId,
      userId,
      params.quota,
      params.sourceType,
      params.sourceId
    );

    return { linked: true, userId, quota: params.quota };
  }

  // Current balance in dollars for the DM "Total" line. Best-effort: returns null
  // if the lookup fails so the DM still sends with just the +amount.
  private static async quotaToBalanceDollars(
    userId: number | null | undefined
  ): Promise<number | null> {
    if (userId == null) return null;
    const res = await getUser(String(userId)).catch(() => null);
    const quota = res?.data?.data?.quota;
    if (typeof quota !== "number" || QUOTA_PER_DOLLAR <= 0) return null;
    return quota / QUOTA_PER_DOLLAR;
  }

  // DM the recipient a reward embed (Top.gg-style). Best-effort: a closed DM or a
  // user the bot can't reach is logged, never throws into the grant flow.
  private static async dmReward(
    targetDiscordId: string,
    userId: number | null | undefined,
    quota: number,
    sourceType: GrantSourceType,
    sourceId?: string | null
  ): Promise<void> {
    const addedDollars = QUOTA_PER_DOLLAR > 0 ? quota / QUOTA_PER_DOLLAR : 0;
    if (addedDollars <= 0) return;
    // Respect the member's per-event DM opt-out (/notifications). The reward
    // still lands + logs in grants-log; only the DM is suppressed.
    if (!(await DmPreferenceService.isDmEnabled(targetDiscordId, sourceType)))
      return;
    const totalDollars = await this.quotaToBalanceDollars(userId);
    // For votes, sourceId is the VoteSite; resolve its human label so the DM names
    // the real site instead of a hardcoded one.
    const voteSiteLabel =
      sourceType === "vote" && sourceId && sourceId in VOTE_SITE_LABEL
        ? VOTE_SITE_LABEL[sourceId as VoteSite]
        : undefined;
    const embed = grantRewardEmbed({
      sourceType,
      addedDollars,
      totalDollars,
      voteAgainHours: sourceType === "vote" ? 12 : undefined,
      voteSiteLabel
    });
    const user = await bot.users.fetch(targetDiscordId).catch(() => null);
    if (!user) return;
    await user.send({ embeds: [embed] }).catch((e) =>
      logger.info("Reward DM not delivered (DMs closed?)", {
        target: targetDiscordId,
        error: String(e)
      })
    );
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
    if (!this.isConfigured()) return { status: ConnectStatus.NotLinked };

    const prior = await db.query.rewardGrant
      .findFirst({
        where: and(
          eq(rewardGrant.targetMemberId, member.id),
          eq(rewardGrant.sourceType, "connect")
        )
      })
      .catch(() => null);

    if (prior) {
      // Already claimed once: they were linked before. Just ensure the role.
      await this.ensureConnectedRole(member);
      return {
        status: ConnectStatus.Connected,
        bonusGranted: false,
        dollars: 0
      };
    }

    const quota = CONNECT_GRANT_QUOTA;
    const result = await this.grantQuota({
      targetDiscordId: member.id,
      quota: quota > 0 ? quota : 1, // endpoint requires > 0; min 1 just verifies the link
      reason: "discord connect bonus",
      sourceType: "connect",
      sourceId: null,
      grantedByDiscordId: "system"
    }).catch(() => ({ linked: false, quota }) as GrantResult);

    if (!result.linked) return { status: ConnectStatus.NotLinked };

    await this.ensureConnectedRole(member);
    return {
      status: ConnectStatus.Connected,
      bonusGranted: quota > 0,
      dollars: CONNECT_GRANT_DOLLARS
    };
  }

  static async ensureConnectedRole(member: GuildMember): Promise<void> {
    const role = member.guild.roles.cache.find(
      (r) => r.name === CONNECTED_ROLE
    );
    if (!role || !role.editable) return;
    if (member.roles.cache.has(role.id)) return;
    await member.roles.add(role, `Discord linked to ${BOT_NAME}`).catch((e) =>
      logger.error("Connected role add failed", {
        member: member.id,
        error: String(e)
      })
    );
  }

  private static async announce(
    targetDiscordId: string,
    quota: number,
    reason: string,
    sourceType: GrantSourceType,
    userId?: number | null
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
    const who = await this.formatUser(guild, targetDiscordId);
    const balance = await this.quotaToBalanceDollars(userId);
    const balanceLabel =
      balance == null
        ? ""
        : ` (new balance **$${balance.toFixed(2)}**)`;
    await channel
      .send({
        content: `\`[${tag}]\` Granted **${dollarLabel}** (${quota} quota) to ${who} - ${reason}${balanceLabel}`,
        allowedMentions: { users: [], roles: [] }
      })
      .catch((e) =>
        logger.error("Grant announce failed", { error: String(e) })
      );
  }

  // Join-log style identifier: mention (username) displayName. Resolves the
  // member, falls back to the user, then to a bare mention if the account is
  // gone - so the log never reads "unknown-user".
  private static async formatUser(
    guild: Guild,
    discordId: string
  ): Promise<string> {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) {
      return `<@${discordId}> (${member.user.username}) ${member.displayName}`;
    }
    const user = await bot.users.fetch(discordId).catch(() => null);
    if (user) {
      return `<@${discordId}> (${user.username})`;
    }
    return `<@${discordId}>`;
  }
}
