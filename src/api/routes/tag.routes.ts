import { db } from "@/lib/db";
import { rewardGrant, serverTagWear } from "@/lib/db-schema";
import { SERVER_TAG_RATE_LIMIT_PCT } from "@/shared/config/rewards";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Elysia } from "elysia";

/**
 * Tag state by new-api user id, for new-api's subscription-expiry sweep.
 *
 * It knows the numeric user id but not the Discord id, so the mapping is
 * recovered from grant history the same way TagRateLimitService does: the id is
 * only ever handed back by grantDiscordQuota, and every wearer has been granted
 * at least once because the tag pays daily.
 */
export const tagRoutes = new Elysia().get(
  "/tag/:newApiUserId",
  async ({ params }) => {
    const userId = parseInt(params.newApiUserId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return { wearing: false, pct: 0 };
    }

    const grant = await db.query.rewardGrant.findFirst({
      columns: { targetMemberId: true },
      where: and(
        eq(rewardGrant.newApiUserId, userId),
        isNotNull(rewardGrant.newApiUserId),
      ),
      orderBy: [desc(rewardGrant.createdAt)],
    });
    if (!grant) return { wearing: false, pct: 0 };

    const wear = await db.query.serverTagWear.findFirst({
      columns: { id: true },
      where: and(
        eq(serverTagWear.memberId, grant.targetMemberId),
        eq(serverTagWear.active, true),
      ),
    });

    return {
      wearing: Boolean(wear),
      pct: wear ? SERVER_TAG_RATE_LIMIT_PCT : 0,
    };
  },
);
