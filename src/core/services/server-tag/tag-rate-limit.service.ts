import { db } from "@/lib/db";
import { rewardGrant } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { getUser, manageUser } from "@/lib/new-api/openapi";
import { SERVER_TAG_RATE_LIMIT_PCT } from "@/shared/config/rewards";
import { DmPreferenceService } from "@/core/services/notifications/dm-preference.service";
import { BOT_NAME, WEBSITE_URL } from "@/shared/config/branding";
import { bot } from "@/main";
import { GrantSource } from "@/types";
import { desc, eq, isNotNull, and } from "drizzle-orm";

const ACTION = "set_free_rate_limit_window_pct";
const PURPLE = 0x9b59ff;
const GREY = 0x9aa0a6;

/**
 * The free-model rate-limit discount that rides along with the server tag.
 *
 * The stored percentage is treated as a FLAG, never as a value to interpret: the
 * only question asked is "is it above 0". That is what lets an admin set their
 * own number in the new-api drawer without the hourly reconcile stomping it an
 * hour later - a non-zero value is already active, whatever its magnitude.
 */
export class TagRateLimitService {
  static isEnabled(): boolean {
    return SERVER_TAG_RATE_LIMIT_PCT > 0;
  }

  /**
   * new-api's user id for a Discord member, recovered from grant history.
   *
   * There is no lookup-by-discord-id endpoint; the id is only ever handed back by
   * grantDiscordQuota. Every tag wearer has been granted at least once (the tag
   * pays daily), so the newest grant carries a usable id. Null means unlinked.
   */
  private static async newApiUserId(memberId: string): Promise<number | null> {
    const row = await db.query.rewardGrant.findFirst({
      columns: { newApiUserId: true },
      where: and(
        eq(rewardGrant.targetMemberId, memberId),
        isNotNull(rewardGrant.newApiUserId),
      ),
      orderBy: [desc(rewardGrant.createdAt)],
    });
    return row?.newApiUserId ?? null;
  }

  private static async currentPct(userId: number): Promise<number | null> {
    const res = await getUser(String(userId)).catch(() => null);
    const raw = res?.data?.data?.setting;
    if (typeof raw !== "string" || !raw) return 0;
    try {
      const pct = Number(
        (JSON.parse(raw) as Record<string, unknown>).free_rate_limit_window_pct,
      );
      return Number.isFinite(pct) && pct > 0 ? pct : 0;
    } catch {
      return null;
    }
  }

  private static async write(userId: number, pct: number): Promise<boolean> {
    // groups/mode are typed required by the generated client but belong to other
    // manage actions; this one reads only id/action/value.
    const res = await manageUser({
      id: userId,
      action: ACTION,
      value: pct,
      groups: null,
      mode: "",
    }).catch(
      (e) => {
        logger.error("Tag rate-limit write failed", {
          user: userId,
          pct,
          error: String(e),
        });
        return null;
      },
    );
    return Boolean(res);
  }

  /**
   * Tell the member the perk turned on or off.
   *
   * Shares the `servertag` DM toggle rather than adding a new one: someone who
   * muted tag payout DMs does not want a second DM about the same tag.
   */
  private static async notify(memberId: string, pct: number): Promise<void> {
    if (!(await DmPreferenceService.isDmEnabled(memberId, GrantSource.ServerTag)))
      return;
    const user = await bot.users.fetch(memberId).catch(() => null);
    if (!user) return;

    const embed = pct > 0
      ? {
          color: PURPLE,
          title: "Server tag perk active",
          description: [
            `Your wait between free model requests is now **${pct}% shorter** while you wear the ${BOT_NAME} tag.`,
            "",
            "It applies on every free model, and stacks with the daily tag reward.",
          ].join("\n"),
        }
      : {
          color: GREY,
          title: "Server tag perk ended",
          description: [
            `You took the ${BOT_NAME} tag off, so the shorter wait between free model requests is back to normal.`,
            "",
            "Put the tag back on to get it again.",
          ].join("\n"),
        };

    await user
      .send({
        embeds: [
          {
            ...embed,
            timestamp: new Date().toISOString(),
            footer: {
              text: `${BOT_NAME} - ${WEBSITE_URL.replace(/^https?:\/\//, "")} - mute these DMs with /notifications`,
            },
          },
        ],
      })
      .catch(() => {});
  }

  /**
   * Bring one member's discount in line with whether they wear the tag.
   *
   * Returns silently for unlinked members: the id only exists once they have been
   * paid at least once, so a later reconcile applies the perk when they link.
   */
  static async sync(memberId: string, wearing: boolean): Promise<void> {
    if (!this.isEnabled()) return;
    const userId = await this.newApiUserId(memberId);
    if (userId == null) return;

    const pct = await this.currentPct(userId);
    // A read failure is not a licence to write: clearing on a transient error
    // would revoke the perk from every wearer the moment new-api hiccups.
    if (pct == null) return;

    if (wearing && pct === 0) {
      if (await this.write(userId, SERVER_TAG_RATE_LIMIT_PCT)) {
        logger.info("Tag rate-limit discount applied", {
          member: memberId,
          user: userId,
          pct: SERVER_TAG_RATE_LIMIT_PCT,
        });
        await this.notify(memberId, SERVER_TAG_RATE_LIMIT_PCT);
      }
      return;
    }
    if (!wearing && pct > 0) {
      if (await this.write(userId, 0)) {
        logger.info("Tag rate-limit discount cleared", {
          member: memberId,
          user: userId,
        });
        await this.notify(memberId, 0);
      }
    }
    // wearing && pct > 0 -> already active, leave the admin's number alone.
  }
}
