import { db } from "@/lib/db";
import { recentMessage } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import type { Message } from "discord.js";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

const RETENTION = sql`CURRENT_TIMESTAMP - INTERVAL '14 days'`;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class RecentMessagesService {
  static async record(message: Message) {
    if (!message.guildId) return;
    await db
      .insert(recentMessage)
      .values({
        messageId: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        authorId: message.author.id,
      })
      .onConflictDoNothing()
      .catch((err) =>
        logger.error("recent message insert failed", { error: String(err) }),
      );
  }

  static async forget(messageIds: string[]) {
    if (messageIds.length === 0) return;
    await db
      .delete(recentMessage)
      .where(inArray(recentMessage.messageId, messageIds))
      .catch((err) =>
        logger.error("recent message delete failed", { error: String(err) }),
      );
  }

  /** The author's message ids from the last 14 days, grouped by channel. */
  static async byChannel(guildId: string, authorId: string) {
    const rows = await db
      .select({
        messageId: recentMessage.messageId,
        channelId: recentMessage.channelId,
      })
      .from(recentMessage)
      .where(
        and(
          eq(recentMessage.guildId, guildId),
          eq(recentMessage.authorId, authorId),
          gte(recentMessage.createdAt, RETENTION),
        ),
      );
    const channels = new Map<string, string[]>();
    for (const row of rows) {
      const ids = channels.get(row.channelId) ?? [];
      ids.push(row.messageId);
      channels.set(row.channelId, ids);
    }
    return channels;
  }

  static startPrune() {
    const prune = () =>
      db
        .delete(recentMessage)
        .where(lt(recentMessage.createdAt, RETENTION))
        .catch((err) =>
          logger.error("recent message prune failed", { error: String(err) }),
        );
    void prune();
    setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  }
}
