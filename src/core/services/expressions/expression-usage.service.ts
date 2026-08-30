import { db } from "@/lib/db";
import { expressionUsage } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Guild, Message, MessageReaction } from "discord.js";

const EMOJI_PATTERN = /<a?:(\w+):(\d+)>/g;

type Hit = { id: string; name: string; kind: "emoji" | "sticker" };

export class ExpressionUsageService {
  private static async bump(
    guild: Guild,
    hits: Hit[],
    column: "messageUses" | "reactionUses",
  ): Promise<void> {
    if (!hits.length) return;
    await MemberDataService.upsertGuild(guild);
    const now = new Date().toISOString();

    for (const hit of hits) {
      await db
        .insert(expressionUsage)
        .values({
          guildId: guild.id,
          expressionId: hit.id,
          kind: hit.kind,
          name: hit.name,
          messageUses: column === "messageUses" ? 1 : 0,
          reactionUses: column === "reactionUses" ? 1 : 0,
          lastUsedAt: now,
        })
        .onConflictDoUpdate({
          target: [expressionUsage.guildId, expressionUsage.expressionId],
          set: {
            [column]: sql`${expressionUsage[column]} + 1`,
            // Refreshed on every hit so a rename does not leave a stale label.
            name: hit.name,
            lastUsedAt: now,
          },
        })
        .catch((e) =>
          logger.error("Expression usage bump failed", {
            expression: hit.id,
            error: String(e),
          }),
        );
    }
  }

  /**
   * Count the guild's OWN emoji and stickers used in a message. External ones
   * are ignored: this exists to retire dead slots, and a slot only exists for
   * something we own.
   */
  static async trackMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    const owned = message.guild.emojis.cache;
    const hits: Hit[] = [];

    for (const match of message.content.matchAll(EMOJI_PATTERN)) {
      const id = match[2]!;
      if (owned.has(id)) hits.push({ id, name: match[1]!, kind: "emoji" });
    }
    for (const sticker of message.stickers.values()) {
      if (message.guild.stickers.cache.has(sticker.id))
        hits.push({ id: sticker.id, name: sticker.name, kind: "sticker" });
    }
    await this.bump(message.guild, hits, "messageUses");
  }

  /** Reactions are where emoji actually get used, so they count separately. */
  static async trackReaction(reaction: MessageReaction): Promise<void> {
    const guild = reaction.message.guild;
    const emoji = reaction.emoji;
    if (!guild || !emoji.id) return;
    if (!guild.emojis.cache.has(emoji.id)) return;
    await this.bump(
      guild,
      [{ id: emoji.id, name: emoji.name ?? emoji.id, kind: "emoji" }],
      "reactionUses",
    );
  }

  /**
   * Every owned expression with its counts, unused ones first. Reports live
   * emoji, not stored rows, so something deleted in Discord disappears here.
   */
  static async report(guild: Guild) {
    const rows = await db
      .select()
      .from(expressionUsage)
      .where(eq(expressionUsage.guildId, guild.id));
    const byId = new Map(rows.map((r) => [r.expressionId, r]));

    const build = (id: string, name: string, kind: "emoji" | "sticker") => {
      const row = byId.get(id);
      return {
        id,
        name,
        kind,
        total: (row?.messageUses ?? 0) + (row?.reactionUses ?? 0),
        messageUses: row?.messageUses ?? 0,
        reactionUses: row?.reactionUses ?? 0,
        lastUsedAt: row?.lastUsedAt ?? null,
      };
    };

    const all = [
      ...guild.emojis.cache.map((e) => build(e.id, e.name ?? e.id, "emoji")),
      ...guild.stickers.cache.map((s) => build(s.id, s.name, "sticker")),
    ];
    all.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    return all;
  }

  static async trackedSince(guildId: string): Promise<string | null> {
    const [row] = await db
      .select({ createdAt: expressionUsage.createdAt })
      .from(expressionUsage)
      .where(and(eq(expressionUsage.guildId, guildId)))
      .orderBy(expressionUsage.createdAt)
      .limit(1);
    return row?.createdAt ?? null;
  }
}
