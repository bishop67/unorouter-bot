import { db } from "@/lib/db";
import { bugReport } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { ButtonId, ButtonIdBuilder } from "@/types/custom-ids";
import { and, eq } from "drizzle-orm";
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
        .setCustomId(ButtonId.BugReward)
        .setLabel("Approve & Reward")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(ButtonId.BugReject)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(ButtonId.BugLock)
        .setLabel("Lock")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ButtonId.BugClose)
        .setLabel("Close")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  static async register(thread: ThreadChannel): Promise<void> {
    if (!thread.guild || !thread.ownerId) return;

    // One-open-per-reporter guard: refuse if this reporter already has an open
    // bug report in this guild. Delete the duplicate thread + DM the reporter
    // a pointer to the existing one so they consolidate context there.
    const existing = await db.query.bugReport.findFirst({
      where: and(
        eq(bugReport.guildId, thread.guild.id),
        eq(bugReport.reporterId, thread.ownerId),
        eq(bugReport.status, "open"),
      ),
    });
    if (existing) {
      const opener = await thread.guild.members
        .fetch(thread.ownerId)
        .catch(() => null);
      await opener?.user
        .send({
          content: `You already have an open bug report: <#${existing.forumThreadId}>. Close or wait for staff to resolve it before opening another. The new thread you just created has been removed.`,
        })
        .catch(() => {});
      await thread
        .delete(`Duplicate bug report from <@${thread.ownerId}>`)
        .catch(() => {});
      return;
    }

    try {
      await db.insert(bugReport).values({
        guildId: thread.guild.id,
        forumThreadId: thread.id,
        reporterId: thread.ownerId,
      });

      // threadCreate fires before the OP's starter message lands. Sending too
      // early throws DiscordAPIError[40058] ("Cannot message this thread until
      // after the post author has sent an initial message"). Poll for the
      // starter message with backoff before posting the controls panel.
      await this.waitForStarterMessage(thread);

      await thread.send({
        content: "Thanks for the report. Staff will review and may reward it.",
        components: [this.buildControls()],
      });
    } catch (err) {
      logger.error("Bug report register failed", { error: String(err) });
    }
  }

  private static async waitForStarterMessage(
    thread: ThreadChannel,
  ): Promise<void> {
    const delays = [250, 500, 1000, 2000, 3000];
    for (let i = 0; i <= delays.length; i++) {
      const msg = await thread.fetchStarterMessage().catch(() => null);
      if (msg) return;
      if (i < delays.length) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }

  static buildRedeemButton(bugId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonIdBuilder.bugRedeem(bugId))
        .setLabel("Redeem reward")
        .setEmoji("🎁")
        .setStyle(ButtonStyle.Success),
    );
  }

  static async getOpen(threadId: string) {
    const row = await db.query.bugReport.findFirst({
      where: eq(bugReport.forumThreadId, threadId),
    });
    return row && row.status === "open" ? row : null;
  }

  static async getById(bugId: number) {
    return db.query.bugReport.findFirst({ where: eq(bugReport.id, bugId) });
  }

  static async setPendingReward(args: {
    bugId: number;
    quota: number;
    reason: string;
    grantedBy: string;
    targetId: string;
  }): Promise<void> {
    await db
      .update(bugReport)
      .set({
        pendingRewardQuota: args.quota,
        pendingRewardReason: args.reason,
        pendingRewardGrantedBy: args.grantedBy,
        pendingRewardTargetId: args.targetId,
      })
      .where(eq(bugReport.id, args.bugId));
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
