import { db } from "@/lib/db";
import { inviteJoin } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import type { Guild, GuildMember, Invite } from "discord.js";

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

    // Unique (guild, invitee): a rejoin conflicts and returns 0 rows, so the
    // reward below only fires on a genuinely new attributed join.
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

    const quota = dollarsToQuota(INVITE_GRANT_DOLLARS);
    if (quota <= 0) return;
    // Unlinked inviters get { linked:false } and are skipped silently, same as
    // votes. Never throws into the join flow.
    await GrantService.grantQuota({
      targetDiscordId: hit.inviterId,
      quota,
      reason: "invited a new member",
      sourceType: "invite",
      sourceId: member.id,
      grantedByDiscordId: "system",
    }).catch((e) =>
      logger.error("Invite reward failed", {
        inviter: hit.inviterId,
        invitee: member.id,
        error: String(e),
      }),
    );
  },
};
