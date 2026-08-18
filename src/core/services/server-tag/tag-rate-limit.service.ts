import { db } from "@/lib/db";
import { rewardGrant } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { getUser, manageUser } from "@/lib/new-api/openapi";
import { SERVER_TAG_RATE_LIMIT_PCT } from "@/shared/config/rewards";
import { desc, eq, isNotNull, and } from "drizzle-orm";

const ACTION = "set_free_rate_limit_window_pct";

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
      }
      return;
    }
    if (!wearing && pct > 0) {
      if (await this.write(userId, 0)) {
        logger.info("Tag rate-limit discount cleared", {
          member: memberId,
          user: userId,
        });
      }
    }
    // wearing && pct > 0 -> already active, leave the admin's number alone.
  }
}
