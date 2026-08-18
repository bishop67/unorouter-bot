import { GrantService } from "@/core/services/grant/grant.service";
import { TagRateLimitService } from "@/core/services/server-tag/tag-rate-limit.service";
import { REWARDS, dollarsToQuota } from "@/shared/config/rewards";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { db } from "@/lib/db";
import { serverTagWear } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { and, eq, lt } from "drizzle-orm";
import type {
  Client,
  Guild,
  GuildMember,
  PartialGuildMember,
  User,
} from "discord.js";

const GRANT_DOLLARS = REWARDS.serverTag;
const PAYOUT_INTERVAL_HOURS = parseInt(
  process.env.SERVER_TAG_PAYOUT_INTERVAL_HOURS || "24",
  10,
);
const PAYOUT_INTERVAL_MS = PAYOUT_INTERVAL_HOURS * 60 * 60 * 1000;
const CRON_INTERVAL_MS = parseInt(
  process.env.SERVER_TAG_CRON_INTERVAL_MS || "3600000", // 1h
  10,
);
// Unlinked days bank instead of being consumed, so a member who links after a
// long unlinked stretch is owed many payouts at once. Drain them a few per tick
// rather than firing one new-api call per owed day in a single pass.
const MAX_CATCHUP_PAYOUTS = 5;

export class ServerTagService {
  /**
   * Whether the user is currently displaying THIS guild's server tag.
   *
   * Both conditions matter. Discord leaves a stale identity_guild_id on users who
   * previously wore a tag the server has since renamed, so matching the guild id
   * alone pays people who took the tag off. identityEnabled is false when they
   * removed it and null when Discord cleared it (e.g. the server lost the perk).
   */
  static isWearingTag(user: User, guildId: string): boolean {
    const identity = user.primaryGuild;
    return (
      identity?.identityEnabled === true &&
      identity.identityGuildId === guildId
    );
  }

  private static async findActiveWear(memberId: string, guildId: string) {
    return db.query.serverTagWear.findFirst({
      where: and(
        eq(serverTagWear.memberId, memberId),
        eq(serverTagWear.guildId, guildId),
        eq(serverTagWear.active, true),
      ),
    });
  }

  private static async openWear(member: GuildMember): Promise<void> {
    // FK parents for the insert below.
    await MemberDataService.upsertGuild(member.guild);
    await MemberDataService.upsertMemberOnly(member);
    await db
      .insert(serverTagWear)
      .values({
        guildId: member.guild.id,
        memberId: member.id,
        nextPayoutAt: new Date(Date.now() + PAYOUT_INTERVAL_MS).toISOString(),
      })
      // The partial unique index absorbs a duplicate gateway delivery racing the
      // startup reconcile.
      .onConflictDoNothing();
    logger.info("Server tag wear opened", {
      member: member.id,
      guild: member.guild.id,
    });
    await TagRateLimitService.sync(member.id, true).catch((e) =>
      logger.error("Tag rate-limit apply failed", {
        member: member.id,
        error: String(e),
      }),
    );
  }

  private static async closeWear(
    memberId: string,
    guildId: string,
  ): Promise<void> {
    await db
      .update(serverTagWear)
      .set({ active: false, cancelledAt: new Date().toISOString() })
      .where(
        and(
          eq(serverTagWear.memberId, memberId),
          eq(serverTagWear.guildId, guildId),
          eq(serverTagWear.active, true),
        ),
      );
    logger.info("Server tag wear closed", { member: memberId, guild: guildId });
    await TagRateLimitService.sync(memberId, false).catch((e) =>
      logger.error("Tag rate-limit clear failed", {
        member: memberId,
        error: String(e),
      }),
    );
  }

  /**
   * Open or close a wear window from a guildMemberUpdate diff.
   *
   * oldMember is often partial, and a partial carries no trustworthy
   * primaryGuild, so the previous state is read from the DB rather than the diff.
   * That makes this idempotent: redelivered events and reconcile races converge
   * on the same row instead of stacking windows.
   */
  static async handleTagChanged(
    _oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    if (GRANT_DOLLARS <= 0) return;
    if (newMember.user.bot) return;

    const guildId = newMember.guild.id;
    const wearing = this.isWearingTag(newMember.user, guildId);
    const active = await this.findActiveWear(newMember.id, guildId);

    if (wearing && !active) {
      await this.openWear(newMember);
      return;
    }
    if (!wearing && active) {
      await this.closeWear(newMember.id, guildId);
    }
  }

  /** Stop accrual when a member leaves while wearing the tag. */
  static async handleMemberLeave(
    member: GuildMember | PartialGuildMember,
  ): Promise<void> {
    if (GRANT_DOLLARS <= 0) return;
    await this.closeWear(member.id, member.guild.id).catch((e) =>
      logger.error("Server tag leave close failed", {
        member: member.id,
        error: String(e),
      }),
    );
  }

  /**
   * Repair state after downtime: gateway events missed while offline would
   * otherwise leave a window open for someone who has since removed the tag, and
   * keep paying them.
   *
   * A window found open for a non-wearer is closed WITHOUT payout - we cannot
   * tell whether the tag came off a minute or a week into the downtime, and
   * partial windows never pay. A wearer with no window starts one from now;
   * credit is never backdated.
   */
  static async reconcile(guild: Guild): Promise<void> {
    if (GRANT_DOLLARS <= 0) return;

    const open = await db.query.serverTagWear.findMany({
      where: and(
        eq(serverTagWear.guildId, guild.id),
        eq(serverTagWear.active, true),
      ),
    });
    const openBy = new Set(open.map((w) => w.memberId));

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      const wearing = this.isWearingTag(member.user, guild.id);
      const hasOpen = openBy.has(member.id);
      // Repair the discount for wearers BEFORE the window check below, which
      // skips steady-state wearers: their window is fine, but the discount can
      // still be missing (linked after putting the tag on, or a failed write).
      // Only wearers are checked - probing every member would cost one new-api
      // read per member per hour to tell ~1200 non-wearers they still have 0.
      if (wearing) {
        await TagRateLimitService.sync(member.id, true).catch(() => {});
      }
      if (wearing === hasOpen) continue;
      try {
        if (wearing) await this.openWear(member);
        else await this.closeWear(member.id, guild.id);
      } catch (e) {
        logger.error("Server tag reconcile failed", {
          member: member.id,
          error: String(e),
        });
      }
    }

    // Windows belonging to members no longer in the guild (left while offline).
    for (const wear of open) {
      if (guild.members.cache.has(wear.memberId)) continue;
      await this.closeWear(wear.memberId, guild.id).catch(() => {});
    }
  }

  static startCron(client: Client): void {
    if (GRANT_DOLLARS <= 0) {
      logger.info("Server tag cron disabled (SERVER_TAG_GRANT_DOLLARS=0)");
      return;
    }
    const tick = async () => {
      try {
        await this.payDueWears();
        for (const guild of client.guilds.cache.values()) {
          await this.reconcile(guild).catch((e) =>
            logger.error("Server tag reconcile tick failed", {
              guild: guild.id,
              error: String(e),
            }),
          );
        }
      } catch (err) {
        logger.error("Server tag cron tick failed", { error: String(err) });
      }
    };
    void tick();
    setInterval(() => void tick(), CRON_INTERVAL_MS);
    logger.info("Server tag cron started", {
      intervalMs: CRON_INTERVAL_MS,
      payoutHours: PAYOUT_INTERVAL_HOURS,
      dollars: GRANT_DOLLARS,
    });
  }

  private static async payDueWears(): Promise<void> {
    const nowIso = new Date().toISOString();
    const due = await db.query.serverTagWear.findMany({
      where: and(
        eq(serverTagWear.active, true),
        lt(serverTagWear.nextPayoutAt, nowIso),
      ),
    });
    if (due.length === 0) return;
    logger.info("Server tag cron: paying due wears", { count: due.length });

    for (const wear of due) {
      try {
        await this.payWear(wear.id, wear.memberId, wear.nextPayoutAt);
      } catch (err) {
        logger.error("Server tag payout failed", {
          wear: wear.id,
          error: String(err),
        });
      }
    }
  }

  // Pays every whole interval the window has earned, up to MAX_CATCHUP_PAYOUTS.
  // Unlike boost slots, nextPayoutAt is only advanced once upstream confirms the
  // recipient is linked, so an unlinked member banks their days instead of
  // forfeiting them and collects the backlog after linking.
  private static async payWear(
    id: number,
    memberId: string,
    nextPayoutAt: string,
  ): Promise<void> {
    let due = new Date(nextPayoutAt).getTime();
    for (let paid = 0; paid < MAX_CATCHUP_PAYOUTS; paid++) {
      if (due >= Date.now()) return;

      const result = await GrantService.grantQuota({
        targetDiscordId: memberId,
        quota: dollarsToQuota(GRANT_DOLLARS),
        reason: "server tag worn",
        sourceType: "servertag",
        sourceId: String(id),
        grantedByDiscordId: "system",
        checkIpUnique: true,
      });

      // Upstream declined to pay (unlinked, or the register IP is shared with an
      // older account). Leave nextPayoutAt alone so the day is retried rather
      // than silently consumed.
      if (!result.linked || result.ipDuplicate) {
        logger.warn("Server tag payout held", {
          wear: id,
          member: memberId,
          reason: result.linked ? "ip_duplicate" : "not_linked",
        });
        return;
      }

      due += PAYOUT_INTERVAL_MS;
      await db
        .update(serverTagWear)
        .set({ nextPayoutAt: new Date(due).toISOString() })
        .where(eq(serverTagWear.id, id));
    }

    if (due < Date.now()) {
      logger.info("Server tag catch-up throttled; backlog continues next tick", {
        wear: id,
        member: memberId,
      });
    }
  }
}
