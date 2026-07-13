import { db } from "@/lib/db";
import { dmOptout } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { isDmToggleable, type GrantSourceType } from "@/types";
import { and, eq } from "drizzle-orm";

export class DmPreferenceService {
  // Whether a reward DM for this source should be sent. Non-toggleable sources
  // (connect, bug, ticket, manual) are always on. A DB read failure fails open
  // (DM sends) so a transient error never silently swallows a reward notice.
  static async isDmEnabled(
    memberId: string,
    source: GrantSourceType,
  ): Promise<boolean> {
    if (!isDmToggleable(source)) return true;
    const row = await db.query.dmOptout
      .findFirst({
        where: and(
          eq(dmOptout.memberId, memberId),
          eq(dmOptout.source, source),
        ),
      })
      .catch((e) => {
        logger.error("DM preference read failed", {
          memberId,
          source,
          error: String(e),
        });
        return null;
      });
    return !row;
  }

  // Set of sources this member has muted (opted out of).
  static async getOptOuts(memberId: string): Promise<Set<GrantSourceType>> {
    const rows = await db.query.dmOptout
      .findMany({ where: eq(dmOptout.memberId, memberId) })
      .catch(() => []);
    return new Set(rows.map((r) => r.source as GrantSourceType));
  }

  // Flip a source's DM on<->off. Returns the NEW enabled state (true = DM on).
  static async toggle(
    memberId: string,
    source: GrantSourceType,
  ): Promise<boolean> {
    const existing = await db.query.dmOptout.findFirst({
      where: and(eq(dmOptout.memberId, memberId), eq(dmOptout.source, source)),
    });
    if (existing) {
      await db.delete(dmOptout).where(eq(dmOptout.id, existing.id));
      return true; // was muted, now on
    }
    await db
      .insert(dmOptout)
      .values({ memberId, source })
      .onConflictDoNothing();
    return false; // now muted
  }
}
