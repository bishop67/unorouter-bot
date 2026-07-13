import { db } from "@/lib/db";
import { levelReward } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import { LEVEL_LIST } from "@/shared/config/levels";
import type { GuildMember } from "discord.js";
import { and, eq } from "drizzle-orm";

type LevelItem = (typeof LEVEL_LIST)[number];

export class LevelRewardService {
  /**
   * Lazy self-heal, run detached on each message and at boot:
   *  - Seed every tier role the member CURRENTLY holds but has no ledger row for
   *    (seeded=true, no pay). Veterans who held level roles before rewards
   *    existed are recorded here so they are never back-paid.
   *  - Retry any genuine level-up that stayed unpaid because the recipient was
   *    unlinked at the time (row with seeded=false, rewarded=false); once they
   *    link, this pays it.
   */
  static async reconcileMember(member: GuildMember): Promise<void> {
    for (const item of LEVEL_LIST) {
      const role = member.guild.roles.cache.find((r) => r.name === item.role);
      if (!role || !member.roles.cache.has(role.id)) continue;

      const existing = await db.query.levelReward
        .findFirst({
          where: and(
            eq(levelReward.memberId, member.id),
            eq(levelReward.guildId, member.guild.id),
            eq(levelReward.tier, item.tier),
          ),
        })
        .catch(() => null);

      if (!existing) {
        // First sighting of a held tier => seed, never pay.
        await db
          .insert(levelReward)
          .values({
            guildId: member.guild.id,
            memberId: member.id,
            tier: item.tier,
            seeded: true,
          })
          .onConflictDoNothing()
          .catch((e) =>
            logger.error("Level reward seed failed", {
              member: member.id,
              tier: item.tier,
              error: String(e),
            }),
          );
        continue;
      }

      // Unpaid genuine level-up (recipient was unlinked before): retry the pay.
      if (!existing.seeded && !existing.rewarded) {
        await this.payRow(member, item, existing.id);
      }
    }
  }

  /**
   * Pay a genuine level-up. Called from the message path the moment the bot adds
   * the tier role. Claims the ledger slot with onConflictDoNothing: a returned
   * row means this is the first time this tier is recorded (fresh level-up) so we
   * try to grant; a conflict means a seeded veteran or an already-recorded tier,
   * so we skip (reconcileMember retries an unpaid one later).
   */
  static async grantTier(member: GuildMember, item: LevelItem): Promise<void> {
    if (item.dollars <= 0) return;

    const claimed = await db
      .insert(levelReward)
      .values({
        guildId: member.guild.id,
        memberId: member.id,
        tier: item.tier,
        seeded: false,
      })
      .onConflictDoNothing()
      .returning({ id: levelReward.id });

    if (!claimed.length) return; // seeded veteran or already recorded

    await this.payRow(member, item, claimed[0]!.id);
  }

  // Attempt the grant for an already-claimed ledger row and flip it to rewarded
  // on success. Unlinked recipient leaves the row seeded=false/rewarded=false so
  // a later reconcile retries it.
  private static async payRow(
    member: GuildMember,
    item: LevelItem,
    rowId: number,
  ): Promise<void> {
    const quota = dollarsToQuota(item.dollars);
    if (quota <= 0) return;

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

    if (!result || !result.linked) return;

    await db
      .update(levelReward)
      .set({
        rewarded: true,
        rewardedQuota: quota,
        rewardedAt: new Date().toISOString(),
      })
      .where(eq(levelReward.id, rowId))
      .catch((e) =>
        logger.error("Level reward mark failed", {
          member: member.id,
          tier: item.tier,
          error: String(e),
        }),
      );
  }
}
