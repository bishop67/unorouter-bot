import { db } from "@/lib/db";
import { inviteJoin, inviteSeed, member, rewardClaim } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { MemberDataService } from "@/core/services/members/member-data.service";
import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import type { Guild, GuildMember, Invite } from "discord.js";
import { and, count, eq } from "drizzle-orm";

const INVITE_GRANT_DOLLARS = parseFloat(
  process.env.INVITE_GRANT_DOLLARS || "0.01",
);

type CachedInvite = {
  uses: number;
  maxUses: number;
  inviterId: string | null;
  inviterIsBot: boolean;
};

// guildId -> invite code -> last known state. Joins are attributed by diffing
// a fresh invites.fetch() against this snapshot.
const cache = new Map<string, Map<string, CachedInvite>>();

function snapshot(invite: Invite): CachedInvite {
  return {
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviterId,
    inviterIsBot: invite.inviter?.bot ?? false,
  };
}

export const InviteService = {
  async primeGuild(guild: Guild): Promise<void> {
    const invites = await guild.invites.fetch().catch((e) => {
      logger.error("Invite cache prime failed", {
        guild: guild.id,
        error: String(e),
      });
      return null;
    });
    if (!invites) return;
    const map = new Map<string, CachedInvite>();
    for (const invite of invites.values()) {
      map.set(invite.code, snapshot(invite));
    }
    cache.set(guild.id, map);
  },

  trackCreate(invite: Invite): void {
    if (!invite.guild) return;
    cache.get(invite.guild.id)?.set(invite.code, snapshot(invite));
  },

  trackDelete(invite: Invite): void {
    if (!invite.guild) return;
    const map = cache.get(invite.guild.id);
    if (!map) return;
    // inviteDelete races the guildMemberAdd that consumed a single-use invite;
    // keep the entry briefly so attribution can still see it.
    setTimeout(() => map.delete(invite.code), 15_000);
  },

  async recordJoin(member: GuildMember): Promise<void> {
    const guild = member.guild;
    const cached = cache.get(guild.id);
    const fresh = await guild.invites.fetch().catch((e) => {
      logger.error("Invite fetch on join failed", {
        guild: guild.id,
        error: String(e),
      });
      return null;
    });
    if (!fresh) return;

    const next = new Map<string, CachedInvite>();
    for (const invite of fresh.values()) {
      next.set(invite.code, snapshot(invite));
    }

    const candidates: Array<{
      code: string;
      inviterId: string | null;
      inviterIsBot: boolean;
    }> = [];
    if (cached) {
      for (const [code, inv] of next) {
        if (inv.uses > (cached.get(code)?.uses ?? 0)) {
          candidates.push({ code, ...inv });
        }
      }
      // Single-use invites vanish on consumption instead of incrementing.
      for (const [code, prev] of cached) {
        if (
          !next.has(code) &&
          prev.maxUses > 0 &&
          prev.uses === prev.maxUses - 1
        ) {
          candidates.push({ code, ...prev });
        }
      }
    }
    cache.set(guild.id, next);

    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        logger.warn("Ambiguous invite attribution, skipping", {
          guild: guild.id,
          member: member.id,
          codes: candidates.map((c) => c.code),
        });
      }
      return;
    }

    const hit = candidates[0]!;
    // Bot inviters = server-listing widgets (DISBOARD, Top.gg), not people.
    if (!hit.inviterId || hit.inviterIsBot || hit.inviterId === member.id) {
      return;
    }

    // invitee_id FKs to members; the join handler upserts the member only AFTER
    // attribution (to keep the invite-diff first), so ensure the member row
    // exists here before the FK insert.
    await MemberDataService.upsertMemberOnly(member);

    // Unique (guild, invitee): a rejoin conflicts and returns 0 rows, so we only
    // reconcile on a genuinely new attributed join.
    const inserted = await db
      .insert(inviteJoin)
      .values({
        guildId: guild.id,
        inviterId: hit.inviterId,
        inviteeId: member.id,
        inviteCode: hit.code,
      })
      .onConflictDoNothing()
      .returning({ id: inviteJoin.id });

    if (!inserted.length) return;

    await InviteService.reconcileInviter(guild.id, hit.inviterId, member.id).catch((e) =>
      logger.error("Invite reconcile failed", {
        inviter: hit.inviterId,
        invitee: member.id,
        error: String(e),
      }),
    );
  },

  // Reconcile one inviter: earned = invite_seeds.uses + count(invite_joins); pay
  // the (earned - already-paid) gap to the inviter if linked, and advance the
  // ledger. Idempotent + backtracking: re-running only pays a newly-earned
  // invite, never re-pays, and back-pays the historical seed baseline once. The
  // per-inviter reward_claims row (source='invite', ref=inviterId) is the ledger.
  async reconcileInviter(
    guildId: string,
    inviterId: string,
    inviteeId?: string,
  ): Promise<void> {
    const quotaPerInvite = dollarsToQuota(INVITE_GRANT_DOLLARS);
    if (quotaPerInvite <= 0) return;

    // The inviter must be a known member (reward_claims.target_member_id FKs to
    // members). Inviters who left before the bot tracked them can't be rewarded.
    const known = await db.query.member.findFirst({
      where: eq(member.memberId, inviterId),
      columns: { memberId: true },
    });
    if (!known) return;

    const [seed] = await db
      .select({ uses: inviteSeed.uses })
      .from(inviteSeed)
      .where(
        and(
          eq(inviteSeed.guildId, guildId),
          eq(inviteSeed.inviterId, inviterId),
        ),
      );
    const [live] = await db
      .select({ c: count() })
      .from(inviteJoin)
      .where(
        and(
          eq(inviteJoin.guildId, guildId),
          eq(inviteJoin.inviterId, inviterId),
        ),
      );
    const earned = (seed?.uses ?? 0) + (live?.c ?? 0);
    if (earned <= 0) return;

    // Claim/find the per-inviter ledger row. earned_units = units already PAID.
    await db
      .insert(rewardClaim)
      .values({
        sourceType: "invite",
        guildId,
        targetMemberId: inviterId,
        refId: inviterId,
        status: "pending",
        earnedUnits: 0,
      })
      .onConflictDoNothing();

    const [claim] = await db
      .select({
        id: rewardClaim.id,
        earnedUnits: rewardClaim.earnedUnits,
        rewardedQuota: rewardClaim.rewardedQuota,
      })
      .from(rewardClaim)
      .where(
        and(
          eq(rewardClaim.sourceType, "invite"),
          eq(rewardClaim.guildId, guildId),
          eq(rewardClaim.targetMemberId, inviterId),
          eq(rewardClaim.refId, inviterId),
        ),
      );
    if (!claim) return;

    const paidUnits = claim.earnedUnits ?? 0;
    const owed = earned - paidUnits;
    if (owed <= 0) return;

    const owedQuota = owed * quotaPerInvite;

    // Claim the units FIRST via a conditional update: advance earned_units to
    // `earned` only if it is still `paidUnits`. Exactly one concurrent reconcile
    // wins this row; losers get 0 rows and stop, so the grant below can never
    // run twice for the same units. If the grant then fails, we roll the units
    // back so a later run retries.
    const claimedUnits = await db
      .update(rewardClaim)
      .set({ earnedUnits: earned, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(rewardClaim.id, claim.id),
          eq(rewardClaim.earnedUnits, paidUnits),
        ),
      )
      .returning({ id: rewardClaim.id });
    if (!claimedUnits.length) return; // lost the race; the winner pays

    const result = await GrantService.grantQuota({
      targetDiscordId: inviterId,
      quota: owedQuota,
      reason:
        owed === 1 ? "invited a new member" : `invited ${owed} new members`,
      sourceType: "invite",
      sourceId: inviterId,
      grantedByDiscordId: "system",
      checkIpUnique: true,
      announceInviteeId: owed === 1 ? inviteeId : null,
    }).catch((e) => {
      logger.error("Invite reward grant failed", {
        inviter: inviterId,
        error: String(e),
      });
      return null;
    });

    // Grant failed or inviter not linked: roll the units back so a later run
    // (after they link) retries. Guard the rollback on the value we set, so a
    // concurrent advance isn't clobbered.
    if (!result || !result.linked) {
      await db
        .update(rewardClaim)
        .set({ earnedUnits: paidUnits, updatedAt: new Date().toISOString() })
        .where(
          and(eq(rewardClaim.id, claim.id), eq(rewardClaim.earnedUnits, earned)),
        )
        .catch(() => {});
      return;
    }

    await db
      .update(rewardClaim)
      .set({
        status: "paid",
        rewardedQuota: claim.rewardedQuota + owedQuota,
        rewardedAt: new Date().toISOString(),
      })
      .where(eq(rewardClaim.id, claim.id))
      .catch((e) =>
        logger.error("Invite ledger advance failed", {
          inviter: inviterId,
          error: String(e),
        }),
      );
  },

  // The join-diff can miss joins (downtime, ambiguous multi-candidate diffs,
  // single-use races), and a missed join is otherwise unrecoverable: earned =
  // seed + attributed joins never catches up. Discord's per-invite `uses`
  // counters are the ground truth members see on their own links, so lift each
  // inviter's seed until seed + joins >= sum(uses) across their live invites.
  // Never lowers: a deleted invite drops out of the sum while the ledger keeps
  // history. Rejoins re-count in `uses`, accepted as the price of recovery.
  async syncSeedsFromLiveUses(guild: Guild): Promise<void> {
    const invites = await guild.invites.fetch().catch((e) => {
      logger.error("Invite fetch for seed sync failed", {
        guild: guild.id,
        error: String(e),
      });
      return null;
    });
    if (!invites) return;

    const liveUses = new Map<string, number>();
    for (const invite of invites.values()) {
      if (!invite.inviterId || invite.inviter?.bot || !invite.uses) continue;
      liveUses.set(
        invite.inviterId,
        (liveUses.get(invite.inviterId) ?? 0) + invite.uses,
      );
    }

    for (const [inviterId, uses] of liveUses) {
      try {
        const [seed] = await db
          .select({ uses: inviteSeed.uses })
          .from(inviteSeed)
          .where(
            and(
              eq(inviteSeed.guildId, guild.id),
              eq(inviteSeed.inviterId, inviterId),
            ),
          );
        const [live] = await db
          .select({ c: count() })
          .from(inviteJoin)
          .where(
            and(
              eq(inviteJoin.guildId, guild.id),
              eq(inviteJoin.inviterId, inviterId),
            ),
          );
        const gap = uses - ((seed?.uses ?? 0) + (live?.c ?? 0));
        if (gap <= 0) continue;
        if (seed) {
          await db
            .update(inviteSeed)
            .set({ uses: seed.uses + gap })
            .where(
              and(
                eq(inviteSeed.guildId, guild.id),
                eq(inviteSeed.inviterId, inviterId),
              ),
            );
        } else {
          await db
            .insert(inviteSeed)
            .values({ guildId: guild.id, inviterId, uses: gap })
            .onConflictDoNothing();
        }
        logger.info("Invite seed lifted from live uses", {
          guild: guild.id,
          inviter: inviterId,
          gap,
        });
      } catch (e) {
        logger.error("Invite seed sync failed", {
          guild: guild.id,
          inviter: inviterId,
          error: String(e),
        });
      }
    }
  },

  // Boot reconcile: pay any invite backlog for every inviter with a seed or a
  // live join. Best-effort per inviter.
  async reconcileAll(guildId: string): Promise<void> {
    const seedInviters = await db
      .select({ inviterId: inviteSeed.inviterId })
      .from(inviteSeed)
      .where(eq(inviteSeed.guildId, guildId));
    const joinInviters = await db
      .selectDistinct({ inviterId: inviteJoin.inviterId })
      .from(inviteJoin)
      .where(eq(inviteJoin.guildId, guildId));

    const inviters = new Set<string>();
    for (const r of seedInviters) inviters.add(r.inviterId);
    for (const r of joinInviters) inviters.add(r.inviterId);

    for (const inviterId of inviters) {
      await InviteService.reconcileInviter(guildId, inviterId).catch((e) =>
        logger.error("Invite reconcile (boot) failed", {
          inviter: inviterId,
          error: String(e),
        }),
      );
    }
  },
};
