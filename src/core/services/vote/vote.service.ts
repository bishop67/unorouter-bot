import { db } from "@/lib/db";
import { rewardGrant, voteRoleHold } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { GrantService, dollarsToQuota } from "@/core/services/grant/grant.service";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { VoteSite, VOTE_SITE_LABEL } from "@/types";
import type { Guild, GuildMember } from "discord.js";
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

// Per-site dedupe window. Webhook/stripped-role sites keep 1h: only guards
// duplicate DELIVERY (Top.gg retries up to ~17min); real cadence enforced by
// the site. DiscordServers is 11h: VoteManager leaves its role on the member
// for a full 12h cycle, so any spurious guildMemberUpdate re-fire inside that
// window reads as a fresh vote - dedupe must span the cadence, not just
// delivery retries. 11h keeps a margin so a legit 12h re-vote never blocks.
const HOUR_MS = 60 * 60 * 1000;
const DEDUPE_MS: Record<VoteSite, number> = {
  [VoteSite.TopGg]: HOUR_MS,
  [VoteSite.Discords]: HOUR_MS,
  [VoteSite.Discadia]: HOUR_MS,
  [VoteSite.DiscordServers]: 11 * HOUR_MS,
};

const VOTE_GRANT_DOLLARS = parseFloat(process.env.VOTE_GRANT_DOLLARS || "0.10");

export type VoteRewardResult =
  | { ok: true; rewarded: boolean; linked: boolean }
  | { ok: false; reason: "duplicate" | "not_configured" | "no_reward" };

export class VoteService {
  /**
   * Reward a voter. Idempotent within the per-site DEDUPE_MS window via
   * grantLog: a prior vote/<site> row for this user inside the window
   * short-circuits, so retries and spurious role re-fires never double-pay.
   * Unlinked voters are skipped silently (logged).
   */
  static async reward(
    voterDiscordId: string,
    site: VoteSite,
  ): Promise<VoteRewardResult> {
    if (!GrantService.isConfigured()) return { ok: false, reason: "not_configured" };

    const quota = dollarsToQuota(VOTE_GRANT_DOLLARS);
    if (quota <= 0) return { ok: false, reason: "no_reward" };

    // createdAt is a mode "string" timestamp: a raw Date here makes postgres-js
    // throw (Buffer.byteLength on a Date), which a swallowed catch turned into
    // "no duplicate found" - dedupe was silently dead until 2026-07-03. Keep
    // the param a string and let failures propagate: fail closed, never pay
    // on an unreadable dedupe state.
    const since = new Date(Date.now() - DEDUPE_MS[site]).toISOString();
    const recent = await db.query.rewardGrant.findFirst({
      where: and(
        eq(rewardGrant.targetMemberId, voterDiscordId),
        eq(rewardGrant.sourceType, "vote"),
        eq(rewardGrant.sourceId, site),
        gte(rewardGrant.createdAt, since),
      ),
    });

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
   * Role-based vote sites add a configured role on each upvote. Rewards fire
   * on the not-held to held transition against vote_role_holds, never on
   * Discord cache diffs: a partial oldMember (uncached after restart) has an
   * empty role cache and reads every held role as just-added (confirmed
   * double-pay 2026-07-03). For sites we own the role on (Discords.com,
   * Discadia: the listing dashboard only adds it), we strip it so the next
   * vote re-adds it. Externally-managed roles (DiscordServers via VoteManager,
   * 12h cycle) stay; their hold clears when the owner bot removes the role.
   */
  static async handleVoteRole(newMember: GuildMember): Promise<void> {
    for (const roleSite of ROLE_VOTE_SITES) {
      const role = newMember.guild.roles.cache.find(
        (r) => r.name === roleSite.roleName,
      );
      if (!role) continue;

      const hasRole = newMember.roles.cache.has(role.id);
      // No catch: on DB failure let the error boundary drop the event. Paying
      // without readable hold state risks double-pay.
      const held = await db.query.voteRoleHold.findFirst({
        where: and(
          eq(voteRoleHold.memberId, newMember.id),
          eq(voteRoleHold.site, roleSite.site),
        ),
      });

      if (!hasRole) {
        // Role removed (owner bot expiry or our strip): clear hold to re-arm.
        if (held) await db.delete(voteRoleHold).where(eq(voteRoleHold.id, held.id));
        continue;
      }

      if (held) continue;

      // vote_role_holds.member_id FKs to members; ensure the member row exists
      // before the claim (an uncached voter may not be upserted yet).
      await MemberDataService.upsertMemberOnly(newMember);

      // Atomic claim: concurrent events race on the unique (member, site) key,
      // only the insert winner pays.
      const claimed = await db
        .insert(voteRoleHold)
        .values({ memberId: newMember.id, site: roleSite.site })
        .onConflictDoNothing()
        .returning();
      if (!claimed.length) continue;

      const result = await this.reward(newMember.id, roleSite.site).catch((e) => {
        logger.error("Vote reward failed", {
          member: newMember.id,
          site: roleSite.site,
          error: String(e),
        });
        return null;
      });

      // Transient failure: release the hold so the next member event retries
      // instead of burning the vote. Duplicates keep the hold.
      if (!result || (!result.ok && result.reason !== "duplicate")) {
        await db
          .delete(voteRoleHold)
          .where(
            and(
              eq(voteRoleHold.memberId, newMember.id),
              eq(voteRoleHold.site, roleSite.site),
            ),
          )
          .catch(() => {});
      }

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

  /**
   * Boot reconciliation, after the member cache warmup: replay transitions
   * missed while the bot was down. Members who gained a vote role get the
   * normal claim + reward (grantLog dedupe blocks re-pays of already-rewarded
   * votes); members who lost one get their hold cleared so the next vote pays.
   * Holds for members who left the guild clear so a rejoin + vote still pays.
   */
  static async reconcileRoleHolds(guild: Guild): Promise<void> {
    const holds = await db.query.voteRoleHold.findMany();
    const heldBy = new Set(holds.map((h) => `${h.memberId}:${h.site}`));
    const siteRoles = ROLE_VOTE_SITES.map((s) => ({
      site: s.site,
      role: guild.roles.cache.find((r) => r.name === s.roleName),
    }));

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      const mismatch = siteRoles.some((s) => {
        const has = s.role ? member.roles.cache.has(s.role.id) : false;
        return has !== heldBy.has(`${member.id}:${s.site}`);
      });
      if (!mismatch) continue;
      await this.handleVoteRole(member).catch((e) =>
        logger.error("Vote hold reconcile failed", {
          member: member.id,
          error: String(e),
        }),
      );
    }

    for (const hold of holds) {
      if (guild.members.cache.has(hold.memberId)) continue;
      await db
        .delete(voteRoleHold)
        .where(eq(voteRoleHold.id, hold.id))
        .catch(() => {});
    }
  }
}
