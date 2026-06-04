import { db } from "@/lib/db";
import { bugReport } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ThreadChannel,
} from "discord.js";

// Forum matched by NAME (substring) so emoji renames don't break config.
const BUG_REPORT_FORUM_NAME =
  process.env.BUG_REPORT_FORUM_CHANNEL?.trim() || "bug-reports";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class BugReportService {
  static isForumConfigured(): boolean {
    return Boolean(BUG_REPORT_FORUM_NAME);
  }

  static isBugThread(thread: ThreadChannel): boolean {
    const parentName = thread.parent?.name;
    if (!parentName) return false;
    return normalize(parentName).includes(normalize(BUG_REPORT_FORUM_NAME));
  }

  static buildControls(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("bug_reward")
        .setLabel("Approve & Reward")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("bug_reject")
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    );
  }

  static async register(thread: ThreadChannel): Promise<void> {
    if (!thread.guild || !thread.ownerId) return;

    try {
      await db.insert(bugReport).values({
        guildId: thread.guild.id,
        forumThreadId: thread.id,
        reporterId: thread.ownerId,
      });

      await thread.send({
        content: "Thanks for the report. Staff will review and may reward it.",
        components: [this.buildControls()],
      });
    } catch (err) {
      logger.error("Bug report register failed", { error: String(err) });
    }
  }

  static async getOpen(threadId: string) {
    const row = await db.query.bugReport.findFirst({
      where: eq(bugReport.forumThreadId, threadId),
    });
    return row && row.status === "open" ? row : null;
  }

  static async markApproved(
    threadId: string,
    resolvedBy: string,
    rewardedQuota: number,
  ): Promise<void> {
    await db
      .update(bugReport)
      .set({
        status: "approved",
        resolvedBy,
        rewardedQuota,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(bugReport.forumThreadId, threadId));
  }

  static async markRejected(
    threadId: string,
    resolvedBy: string,
  ): Promise<void> {
    await db
      .update(bugReport)
      .set({
        status: "rejected",
        resolvedBy,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(bugReport.forumThreadId, threadId));
  }
}
