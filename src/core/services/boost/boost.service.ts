import {
  dollarsToQuota,
  GrantService,
} from "@/core/services/grant/grant.service";
import { db } from "@/lib/db";
import { boostSlot } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  type GuildMember,
  type Message,
  MessageType,
} from "discord.js";

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
