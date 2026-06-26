import { db } from "@/lib/db";
import { grantLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { GrantService, dollarsToQuota } from "@/core/services/grant/grant.service";
import { VoteSite, VOTE_SITE_LABEL } from "@/types";
import type { GuildMember, PartialGuildMember } from "discord.js";
import { and, eq, gte } from "drizzle-orm";

// Role-based vote sites: dashboard adds a role on upvote, no webhook. Maps the
// configured role NAME to its VoteSite for attribution. Each site needs its own
// role so grants log the correct source.
const ROLE_VOTE_SITES: ReadonlyArray<readonly [string, VoteSite]> = [
  [process.env.DISCORDS_VOTE_ROLE?.trim() || "", VoteSite.Discords],
  [process.env.DISCADIA_VOTE_ROLE?.trim() || "", VoteSite.Discadia],
].filter(([name]) => name) as ReadonlyArray<readonly [string, VoteSite]>;

// Dedupe guard against duplicate webhook DELIVERY (the site retries on timeout
// or 5xx, up to ~17min for Top.gg), NOT a vote-frequency cap - the listing site
// enforces real cadence (12h default, 6h on some premium tiers). Kept short so a
// legitimate re-vote at any site's cadence is never blocked.
const DEDUPE_MS = 60 * 60 * 1000;

const VOTE_GRANT_DOLLARS = parseFloat(process.env.VOTE_GRANT_DOLLARS || "0.10");

export type VoteRewardResult =
  | { ok: true; rewarded: boolean; linked: boolean }
  | { ok: false; reason: "duplicate" | "not_configured" | "no_reward" };

export class VoteService {
  /**
   * Reward a voter. Idempotent within the 12h cooldown via grantLog: a prior
   * vote/<site> row for this user inside the window short-circuits, so site
   * retries never double-pay. Unlinked voters are skipped silently (logged).
   */
  static async reward(
    voterDiscordId: string,
    site: VoteSite,
  ): Promise<VoteRewardResult> {
    if (!GrantService.isConfigured()) return { ok: false, reason: "not_configured" };

    const quota = dollarsToQuota(VOTE_GRANT_DOLLARS);
    if (quota <= 0) return { ok: false, reason: "no_reward" };

    const since = new Date(Date.now() - DEDUPE_MS);
    const recent = await db.query.grantLog
      .findFirst({
        where: and(
          eq(grantLog.targetDiscordId, voterDiscordId),
          eq(grantLog.sourceType, "vote"),
          eq(grantLog.sourceId, site),
          gte(grantLog.createdAt, since),
        ),
      })
      .catch(() => null);

    if (recent) {
      logger.info("Vote reward skipped: duplicate delivery", { voterDiscordId, site });
      return { ok: false, reason: "duplicate" };
    }

    const result = await GrantService.grantQuota({
      targetDiscordId: voterDiscordId,
      quota,
      reason: `vote on ${VOTE_SITE_LABEL[site]}`,
      sourceType: "vote",
      sourceId: site,
      grantedByDiscordId: "system",
    }).catch((e) => {
      logger.error("Vote grant failed", { voterDiscordId, site, error: String(e) });
      return null;
    });

    if (!result) return { ok: false, reason: "no_reward" };

    if (!result.linked) {
      logger.info("Vote reward skipped: voter not linked", { voterDiscordId, site });
      return { ok: true, rewarded: false, linked: false };
    }

    logger.info("Vote rewarded", { voterDiscordId, site, quota });
    return { ok: true, rewarded: true, linked: true };
  }

  /**
   * Discords.com and Discadia have no vote webhook; their dashboards add a
   * configured role on each upvote. We treat the role-add as the vote signal:
   * reward for the matching site, then strip the role so the next vote re-adds it
   * (and an unlinked voter keeps no stale role).
   */
  static async handleVoteRole(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    for (const [roleName, site] of ROLE_VOTE_SITES) {
      const role = newMember.guild.roles.cache.find((r) => r.name === roleName);
      if (!role) continue;

      const justAdded =
        newMember.roles.cache.has(role.id) && !oldMember.roles.cache.has(role.id);
      if (!justAdded) continue;

      await this.reward(newMember.id, site).catch((e) =>
        logger.error("Vote reward failed", {
          member: newMember.id,
          site,
          error: String(e),
        }),
      );

      // Strip the role regardless of grant outcome so the next vote re-triggers.
      if (role.editable) {
        await newMember.roles
          .remove(role, `${VOTE_SITE_LABEL[site]} vote reward processed`)
          .catch((e) =>
            logger.info("Could not remove vote role", {
              member: newMember.id,
              site,
              error: String(e),
            }),
          );
      }
    }
  }
}
