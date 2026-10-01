import { db } from "@/lib/db";
import { watchlist } from "@/lib/db-schema";
import { and, desc, eq } from "drizzle-orm";

export class WatchlistService {
  static async add(
    guildId: string,
    memberId: string,
    username: string,
    addedBy: string,
  ) {
    const [added] = await db
      .insert(watchlist)
      .values({ guildId, memberId, username, addedBy })
      .onConflictDoNothing()
      .returning();
    if (added) return { added: true, entry: added };

    const [existing] = await db
      .select()
      .from(watchlist)
      .where(
        and(eq(watchlist.guildId, guildId), eq(watchlist.memberId, memberId)),
      );
    return { added: false, entry: existing };
  }

  static list(guildId: string) {
    return db
      .select()
      .from(watchlist)
      .where(eq(watchlist.guildId, guildId))
      .orderBy(desc(watchlist.createdAt), desc(watchlist.id));
  }

  static async remove(guildId: string, memberId: string) {
    const [removed] = await db
      .delete(watchlist)
      .where(
        and(eq(watchlist.guildId, guildId), eq(watchlist.memberId, memberId)),
      )
      .returning();
    return removed ?? null;
  }
}
