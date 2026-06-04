import { db } from "@/lib/db";
import { bugReport } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import type { ThreadChannel } from "discord.js";

// Bug-bounty forum thread deleted by an admin. Mark the matching bug report
// as rejected (with the bot itself as resolver since we have no actor here)
// so the one-open-per-reporter guard releases.
export async function handleThreadDelete(
  thread: ThreadChannel,
): Promise<void> {
  try {
    const result = await db
      .update(bugReport)
      .set({
        status: "rejected",
        resolvedAt: new Date().toISOString(),
        resolvedBy: "system:thread_delete",
      })
      .where(
        and(eq(bugReport.forumThreadId, thread.id), eq(bugReport.status, "open")),
      )
      .returning({ id: bugReport.id });
    if (result.length > 0) {
      logger.info("Bug report closed via thread delete", {
        bugId: result[0]!.id,
        threadId: thread.id,
      });
    }
  } catch (err) {
    logger.error("threadDelete handler failed", { error: String(err) });
  }
}
