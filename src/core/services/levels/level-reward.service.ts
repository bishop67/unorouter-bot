import { db } from "@/lib/db";
import { memberMessages, rewardClaim } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import { LEVEL_LIST } from "@/shared/config/levels";
import type { GuildMember } from "discord.js";
import { and, count, eq } from "drizzle-orm";

type LevelItem = (typeof LEVEL_LIST)[number];

export class LevelRewardService {
  /**
   * Reconcile a member's level rewards against their true message count. For
   * every tier they qualify for (count >= threshold) with no reward_claims row
   * yet, claim and grant. Idempotent: the unique (source, guild, target, ref)
   * claim row is the once-guard, so this can run on every message and at boot and
   * only ever pays a tier once. Back-pays activity earned before rewards existed.
   */
  static async reconcileMember(member: GuildMember): Promise<void> {
    const qualifying = LEVEL_LIST.filter((item) => item.dollars > 0);
    if (qualifying.length === 0) return;

    const [row] = await db
      .select({ count: count() })
      .from(memberMessages)
      .where(
        and(
          eq(memberMessages.memberId, member.id),
          eq(memberMessages.guildId, member.guild.id),
        ),
      );
    const messageCount = row?.count ?? 0;

    for (const item of qualifying) {
      if (messageCount < item.count) continue;
      await this.payTier(member, item);
    }
  }

  /**
   * Pay a single tier once. Claims the reward_claims row (source='level',
   * ref=tier) with onConflictDoNothing: a returned row means this tier is not yet
   * recorded, so we grant; a conflict means it was already claimed/paid, so we
   * skip. Called by both the live level-up path and reconcile.
   */
  static async payTier(member: GuildMember, item: LevelItem): Promise<void> {
    if (item.dollars <= 0) return;
    const quota = dollarsToQuota(item.dollars);
    if (quota <= 0) return;

    const claimed = await db
      .insert(rewardClaim)
      .values({
        sourceType: "level",
        guildId: member.guild.id,
        targetMemberId: member.id,
        refId: String(item.tier),
        status: "pending",
        pendingQuota: quota,
        pendingReason: `reached level ${item.role}`,
      })
      .onConflictDoNothing()
      .returning({ id: rewardClaim.id });

    if (!claimed.length) return; // already recorded

    const result = await GrantService.grantQuota({
      targetDiscordId: member.id,
      quota,
      reason: `reached level ${item.role}`,
      sourceType: "level",
      sourceId: String(item.tier),
      grantedByDiscordId: "system",
    }).catch((e) => {
      logger.error("Level reward grant failed", {
        member: member.id,
        tier: item.tier,
        error: String(e),
      });
      return null;
    });

    // Unlinked (or failed): release the claim so a later run retries after the
    // member links. Only a real credit keeps the claim.
    if (!result || !result.linked) {
      await db
        .delete(rewardClaim)
        .where(eq(rewardClaim.id, claimed[0]!.id))
        .catch(() => {});
      return;
    }

    await db
      .update(rewardClaim)
      .set({
        status: "paid",
        rewardedQuota: quota,
        rewardedAt: new Date().toISOString(),
      })
      .where(eq(rewardClaim.id, claimed[0]!.id))
      .catch((e) =>
        logger.error("Level reward mark failed", {
          member: member.id,
          tier: item.tier,
          error: String(e),
        }),
      );
  }
}
