import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import { db } from "@/lib/db";
import { boostSlot } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  type Guild,
  type GuildMember,
  type Message,
  MessageType,
} from "discord.js";

export type BackfillSummary = {
  created: number;
  skipped: number;
  retroMonths: number;
  retroDollars: number;
  dryRun: boolean;
  unpaid: {
    memberId: string;
    username: string;
    dollars: number;
    reason: "ip_duplicate" | "not_linked";
  }[];
};

const BOOST_GRANT_DOLLARS = parseFloat(process.env.BOOST_GRANT_DOLLARS || "0");
const PAYOUT_INTERVAL_DAYS = parseInt(
  process.env.BOOST_PAYOUT_INTERVAL_DAYS || "30",
  10,
);
const PAYOUT_INTERVAL_MS = PAYOUT_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
const CRON_INTERVAL_MS = parseInt(
  process.env.BOOST_CRON_INTERVAL_MS || "3600000", // 1h
  10,
);
// Ceiling on retroactive credit per member: backfill pays a lump sum that cannot
// be reversed, so an ancient booster must not be able to collect unbounded months.
const BACKFILL_RETRO_MAX_MONTHS = parseInt(
  process.env.BOOST_BACKFILL_RETRO_MAX_MONTHS || "12",
  10,
);

const BOOST_MESSAGE_TYPES: number[] = [
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
];

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export class BoostService {
  static isBoostSystemMessage(message: Message): boolean {
    return BOOST_MESSAGE_TYPES.includes(message.type);
  }

  /**
   * Handle a Discord PREMIUM_GUILD_SUBSCRIPTION system message. One row per
   * subscription slot. Discord posts one message per individual boost
   * transaction so multi-boost users get multiple rows naturally.
   */
  static async handleBoostMessage(message: Message): Promise<void> {
    if (!message.guild) return;
    if (BOOST_GRANT_DOLLARS <= 0) return;

    const memberId = message.author.id;
    const now = new Date();
    const nextPayoutAt = plusDays(now, PAYOUT_INTERVAL_DAYS).toISOString();

    try {
      await db.insert(boostSlot).values({
        guildId: message.guild.id,
        memberId,
        sourceMessageId: message.id,
        nextPayoutAt,
      });
    } catch (err) {
      logger.error("Boost slot insert failed", { error: String(err) });
      return;
    }

    // Instant first-month payout.
    try {
      const result = await GrantService.grantQuota({
        targetDiscordId: memberId,
        quota: dollarsToQuota(BOOST_GRANT_DOLLARS),
        reason: "server boost",
        sourceType: "boost",
        sourceId: message.id,
        grantedByDiscordId: "system",
        checkIpUnique: true,
      });
      const member = await message.guild.members
        .fetch(memberId)
        .catch(() => null);
      if (result.linked) {
        await member?.user
          .send(
            `Thanks for boosting! You earned **$${BOOST_GRANT_DOLLARS}** balance, and every $${BOOST_GRANT_DOLLARS}/month while you keep boosting lands automatically. 💜`,
          )
          .catch(() => {});
      } else {
        await member?.user
          .send(
            `Thanks for boosting! ${GrantService.linkPrompt()} Once linked, your boost reward (and every $${BOOST_GRANT_DOLLARS}/month while you keep boosting) lands automatically.`,
          )
          .catch(() => {});
      }
    } catch (err) {
      logger.error("Boost grant failed", { error: String(err) });
    }
  }

  /**
   * Called from guildMemberUpdate when premiumSince transitions set -> null:
   * the user cancelled all their boosts. Deactivate every active slot for
   * them so the monthly cron stops paying.
   */
  static async handleBoostCancelled(member: GuildMember): Promise<void> {
    try {
      await db
        .update(boostSlot)
        .set({ active: false, cancelledAt: new Date().toISOString() })
        .where(
          and(
            eq(boostSlot.guildId, member.guild.id),
            eq(boostSlot.memberId, member.id),
            eq(boostSlot.active, true),
          ),
        );
      logger.info("Deactivated boost slots on cancel", {
        member: member.id,
      });
    } catch (err) {
      logger.error("Boost cancel handler failed", { error: String(err) });
    }
  }

  /**
   * Monthly recurring cron. Pays $BOOST_GRANT_DOLLARS for every active slot
   * whose nextPayoutAt is due, then bumps nextPayoutAt by one interval. Runs
   * forever while the user keeps boosting.
   */
  static startCron(): void {
    if (BOOST_GRANT_DOLLARS <= 0) {
      logger.info("Boost cron disabled (BOOST_GRANT_DOLLARS=0)");
      return;
    }
    const tick = async () => {
      try {
        await this.payDueSlots();
      } catch (err) {
        logger.error("Boost cron tick failed", { error: String(err) });
      }
    };
    void tick();
    setInterval(() => void tick(), CRON_INTERVAL_MS);
    logger.info("Boost cron started", {
      intervalMs: CRON_INTERVAL_MS,
      payoutDays: PAYOUT_INTERVAL_DAYS,
    });
  }

  private static async payDueSlots(): Promise<void> {
    const nowIso = new Date().toISOString();
    const due = await db.query.boostSlot.findMany({
      where: and(
        eq(boostSlot.active, true),
        lt(boostSlot.nextPayoutAt, nowIso),
      ),
    });
    if (due.length === 0) return;
    logger.info("Boost cron: paying due slots", { count: due.length });

    for (const slot of due) {
      try {
        const result = await GrantService.grantQuota({
          targetDiscordId: slot.memberId,
          quota: dollarsToQuota(BOOST_GRANT_DOLLARS),
          reason: `boost monthly slot #${slot.id}`,
          sourceType: "boost",
          sourceId: String(slot.id),
          grantedByDiscordId: "system",
          checkIpUnique: true,
        });
        // Always bump nextPayoutAt forward by one interval; if the user is
        // unlinked we still keep the schedule going so they get the missed
        // months as soon as they link (the grant call just no-ops with
        // linked:false). Alternative: skip until linked. Keep it simple +
        // honour the public promise of "$1/month while boosting".
        const nextDate = new Date(
          new Date(slot.nextPayoutAt).getTime() + PAYOUT_INTERVAL_MS,
        ).toISOString();
        await db
          .update(boostSlot)
          .set({ nextPayoutAt: nextDate })
          .where(eq(boostSlot.id, slot.id));
        if (!result.linked) {
          logger.warn("Boost monthly paid: recipient unlinked, skipped grant", {
            slot: slot.id,
            member: slot.memberId,
          });
        }
      } catch (err) {
        logger.error("Boost slot payout failed", {
          slot: slot.id,
          error: String(err),
        });
      }
    }
  }

  /**
   * Create slots for boosters the bot never saw boost.
   *
   * Slots are only ever created from the PREMIUM_GUILD_SUBSCRIPTION system
   * message, so anyone already boosting before the bot shipped - or who boosted
   * while it was down - has premiumSince set but no row, and the monthly cron
   * never pays them. This reconciles that.
   *
   * Discord exposes no per-member boost count to bots (premiumSubscriptionCount
   * is guild-wide; the per-member endpoint is user-token only), so this creates
   * exactly ONE slot per booster. Members holding multiple boosts from before the
   * bot shipped are under-credited and need a manual /grant to top up.
   *
   * Idempotent: members with an active slot are skipped, so it is safe to re-run.
   */
  static async backfillGuild(
    guild: Guild,
    opts: { dryRun: boolean },
  ): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      created: 0,
      skipped: 0,
      retroMonths: 0,
      retroDollars: 0,
      dryRun: opts.dryRun,
      unpaid: [],
    };
    if (BOOST_GRANT_DOLLARS <= 0) {
      logger.info("Boost backfill skipped (BOOST_GRANT_DOLLARS=0)");
      return summary;
    }

    const existing = await db.query.boostSlot.findMany({
      where: and(eq(boostSlot.guildId, guild.id), eq(boostSlot.active, true)),
    });
    const hasSlot = new Set(existing.map((s) => s.memberId));

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      if (!member.premiumSince) continue;
      if (hasSlot.has(member.id)) {
        summary.skipped++;
        continue;
      }

      const retroMonths = this.monthsSince(member.premiumSince);
      const retroDollars = retroMonths * BOOST_GRANT_DOLLARS;
      summary.created++;
      summary.retroMonths += retroMonths;
      summary.retroDollars += retroDollars;

      if (opts.dryRun) {
        logger.info("Boost backfill (dry run)", {
          member: member.id,
          username: member.user.username,
          premiumSince: member.premiumSince.toISOString(),
          retroMonths,
          retroDollars,
        });
        continue;
      }

      try {
        await MemberDataService.upsertMemberOnly(member);
        await db.insert(boostSlot).values({
          guildId: guild.id,
          memberId: member.id,
          sourceMessageId: null,
          nextPayoutAt: plusDays(new Date(), PAYOUT_INTERVAL_DAYS).toISOString(),
        });
        // Retro months land as ONE grant, not N, to keep grants-log readable and
        // avoid hammering new-api.
        if (retroDollars > 0) {
          const result = await GrantService.grantQuota({
            targetDiscordId: member.id,
            quota: dollarsToQuota(retroDollars),
            reason: `boost backfill: ${retroMonths} month(s) since ${member.premiumSince.toISOString().slice(0, 10)}`,
            sourceType: "boost",
            sourceId: null,
            grantedByDiscordId: "system",
            checkIpUnique: true,
          });
          // The slot is kept either way (it starts the monthly clock), but an
          // unpaid retro grant is never retried: this run is the only attempt,
          // so surface it for a manual /grant.
          if (!result.linked || result.ipDuplicate) {
            summary.unpaid.push({
              memberId: member.id,
              username: member.user.username,
              dollars: retroDollars,
              reason: result.linked ? "ip_duplicate" : "not_linked",
            });
            summary.retroDollars -= retroDollars;
            summary.retroMonths -= retroMonths;
          }
        }
      } catch (err) {
        logger.error("Boost backfill failed for member", {
          member: member.id,
          error: String(err),
        });
      }
    }

    logger.info("Boost backfill complete", { guild: guild.id, ...summary });
    return summary;
  }

  // Whole months elapsed, clamped so a very old booster cannot collect an
  // unbounded lump sum the moment backfill runs.
  private static monthsSince(since: Date): number {
    const now = new Date();
    let months =
      (now.getFullYear() - since.getFullYear()) * 12 +
      (now.getMonth() - since.getMonth());
    if (now.getDate() < since.getDate()) months--;
    return Math.max(0, Math.min(months, BACKFILL_RETRO_MAX_MONTHS));
  }

  // Internal: expose count helper for diagnostics / future commands.
  static async countActiveSlots(
    guildId: string,
    memberId: string,
  ): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(boostSlot)
      .where(
        and(
          eq(boostSlot.guildId, guildId),
          eq(boostSlot.memberId, memberId),
          eq(boostSlot.active, true),
          gte(boostSlot.id, 0),
        ),
      );
    return rows[0]?.c ?? 0;
  }
}
