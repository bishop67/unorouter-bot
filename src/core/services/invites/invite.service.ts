import { db } from "@/lib/db";
import { inviteJoin } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import type { Guild, GuildMember, Invite } from "discord.js";

type CachedInvite = { uses: number; maxUses: number; inviterId: string | null };

// guildId -> invite code -> last known state. Joins are attributed by diffing
// a fresh invites.fetch() against this snapshot.
const cache = new Map<string, Map<string, CachedInvite>>();

function snapshot(invite: Invite): CachedInvite {
  return {
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviterId,
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

    const candidates: Array<{ code: string; inviterId: string | null }> = [];
    if (cached) {
      for (const [code, inv] of next) {
        if (inv.uses > (cached.get(code)?.uses ?? 0)) {
          candidates.push({ code, inviterId: inv.inviterId });
        }
      }
      // Single-use invites vanish on consumption instead of incrementing.
      for (const [code, prev] of cached) {
        if (
          !next.has(code) &&
          prev.maxUses > 0 &&
          prev.uses === prev.maxUses - 1
        ) {
          candidates.push({ code, inviterId: prev.inviterId });
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
    if (!hit.inviterId || hit.inviterId === member.id) return;

    await db
      .insert(inviteJoin)
      .values({
        guildId: guild.id,
        inviterId: hit.inviterId,
        inviteeId: member.id,
        inviteCode: hit.code,
      })
      .onConflictDoNothing();
  },
};
