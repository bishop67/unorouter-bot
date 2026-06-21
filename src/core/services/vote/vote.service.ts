import { db } from "@/lib/db";
import { grantLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { GrantService, dollarsToQuota } from "@/core/services/grant/grant.service";
import { VOTE_SITE_LABEL, type VoteSite } from "@/types";
import { and, eq, gte } from "drizzle-orm";

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
}
