import { db } from "@/lib/db";
import { grantLog } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { GrantService, dollarsToQuota } from "@/core/services/grant/grant.service";
import { VoteSite, VOTE_SITE_LABEL } from "@/types";
import type { GuildMember, PartialGuildMember } from "discord.js";
import { and, eq, gte } from "drizzle-orm";

// Role-based vote sites: a role is added on upvote, no webhook. Maps the configured
// role NAME to its VoteSite for attribution. Each site needs its own role so grants
// log the correct source. `ownsRole` true means an EXTERNAL bot manages the role's
// lifecycle (VoteManager.xyz for DiscordServers: adds on vote, removes after a set
// duration), so we must NOT strip it - the grantLog dedupe window guards double-pay.
// false means the listing site only adds the role and we strip it to re-arm.
type RoleVoteSite = { roleName: string; site: VoteSite; ownsRole: boolean };
const ROLE_VOTE_SITES: ReadonlyArray<RoleVoteSite> = [
  { roleName: process.env.DISCORDS_VOTE_ROLE?.trim() || "", site: VoteSite.Discords, ownsRole: false },
  { roleName: process.env.DISCADIA_VOTE_ROLE?.trim() || "", site: VoteSite.Discadia, ownsRole: false },
  { roleName: process.env.DISCORDSERVERS_VOTE_ROLE?.trim() || "", site: VoteSite.DiscordServers, ownsRole: true },
].filter((s) => s.roleName);

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
   * Role-based vote sites add a configured role on each upvote. We treat the
   * role-add as the vote signal and reward the matching site. For sites we own the
   * role on (Discords.com, Discadia: the listing dashboard only adds it), we strip
   * it so the next vote re-adds and re-triggers. For externally-managed roles
   * (DiscordServers via VoteManager, which removes the role itself after a set
   * duration), we leave it; the grantLog dedupe window prevents double-pay if the
   * lingering role fires another guildMemberUpdate.
   */
  static async handleVoteRole(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    for (const roleSite of ROLE_VOTE_SITES) {
      const role = newMember.guild.roles.cache.find(
        (r) => r.name === roleSite.roleName,
      );
      if (!role) continue;

      const justAdded =
        newMember.roles.cache.has(role.id) && !oldMember.roles.cache.has(role.id);
      if (!justAdded) continue;

      await this.reward(newMember.id, roleSite.site).catch((e) =>
        logger.error("Vote reward failed", {
          member: newMember.id,
          site: roleSite.site,
          error: String(e),
        }),
      );

      // Strip only roles WE own, so the next vote re-triggers. Externally-managed
      // roles are left for their owner bot to remove on its own schedule.
      if (!roleSite.ownsRole && role.editable) {
        await newMember.roles
          .remove(role, `${VOTE_SITE_LABEL[roleSite.site]} vote reward processed`)
          .catch((e) =>
            logger.info("Could not remove vote role", {
              member: newMember.id,
              site: roleSite.site,
              error: String(e),
            }),
          );
      }
    }
  }
}
