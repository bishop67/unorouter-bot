import { db } from "@/lib/db";
import {
  giveawayRaffle,
  giveawayRaffleEntry,
  giveawayRaffleWinner,
} from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { GiveawayService } from "@/core/services/giveaway/giveaway.service";
import { isLinked } from "@/core/utils/command.utils";
import { RAFFLE_MAX_DURATION_DAYS } from "@/shared/config/giveaway";
import { BOT_NAME } from "@/shared/config/branding";
import { ButtonIdBuilder } from "@/types/custom-ids";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

type RaffleRow = typeof giveawayRaffle.$inferSelect;

export type EnterResult =
  | { ok: true; fresh: boolean; entries: number }
  | { ok: false; reason: "ended" | "not_verified" };

const PURPLE = 0x9b59ff;

export class RaffleService {
  /**
   * GiveawayBot's duration format ("30s", "2h", "7d"), because that is what
   * members and staff already recognise from other servers.
   */
  static parseDuration(input: string): number | null {
    const match = /^(\d+)\s*([smhd])$/i.exec(input.trim());
    if (!match) return null;
    const amount = parseInt(match[1]!, 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2]!.toLowerCase();
    const ms =
      unit === "s"
        ? amount * 1000
        : unit === "m"
          ? amount * 60_000
          : unit === "h"
            ? amount * 3_600_000
            : amount * 86_400_000;
    if (ms > RAFFLE_MAX_DURATION_DAYS * 86_400_000) return null;
    return ms;
  }

  static async byId(id: number, guildId: string): Promise<RaffleRow | null> {
    const row = await db.query.giveawayRaffle.findFirst({
      where: and(eq(giveawayRaffle.id, id), eq(giveawayRaffle.guildId, guildId)),
    });
    return row ?? null;
  }

  static async running(guildId: string): Promise<RaffleRow[]> {
    return db.query.giveawayRaffle.findMany({
      where: and(
        eq(giveawayRaffle.guildId, guildId),
        isNull(giveawayRaffle.endedAt),
      ),
    });
  }

  static async entryCount(raffleId: number): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(giveawayRaffleEntry)
      .where(eq(giveawayRaffleEntry.raffleId, raffleId));
    return rows[0]?.count ?? 0;
  }

  static channel(guild: Guild): TextChannel | null {
    return GiveawayService.announceChannel(guild);
  }

  static async create(params: {
    guild: Guild;
    channel: TextChannel;
    prize: string;
    code: string | null;
    durationMs: number;
    verifiedOnly: boolean;
    createdByMemberId: string | null;
  }): Promise<RaffleRow | null> {
    const endsAt = new Date(Date.now() + params.durationMs).toISOString();
    const rows = await db
      .insert(giveawayRaffle)
      .values({
        guildId: params.guild.id,
        channelId: params.channel.id,
        prize: params.prize,
        code: params.code,
        verifiedOnly: params.verifiedOnly,
        createdByMemberId: params.createdByMemberId,
        endsAt,
      })
      .returning();
    const raffle = rows[0];
    if (!raffle) return null;

    const panel = this.panelEmbed(raffle, 0);
    const sent = await params.channel
      .send({ embeds: [panel.embed], components: [panel.row] })
      .catch((e) => {
        logger.error("Raffle panel post failed", {
          raffle: raffle.id,
          error: String(e),
        });
        return null;
      });
    if (sent) {
      await db
        .update(giveawayRaffle)
        .set({ messageId: sent.id })
        .where(eq(giveawayRaffle.id, raffle.id));
      raffle.messageId = sent.id;
    }
    logger.info("Raffle created", {
      raffle: raffle.id,
      prize: raffle.prize,
      endsAt,
    });
    return raffle;
  }

  static panelEmbed(
    raffle: RaffleRow,
    entries: number,
  ): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
    // Discord renders the timestamp live, so the countdown stays correct
    // without the bot editing the message.
    const endsAt = Math.floor(new Date(raffle.endsAt).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle(`🎁 ${raffle.prize}`)
      .setDescription(
        [
          `Hit **Enter** below for a chance to win. One winner, drawn at random.`,
          "",
          `Ends <t:${endsAt}:R> (<t:${endsAt}:f>)`,
          `Entries: **${entries}**`,
          ...(raffle.verifiedOnly
            ? ["", "Verified members only - link your account first."]
            : []),
          "",
          "The winner is announced here and gets their prize by DM, so keep DMs open.",
        ].join("\n"),
      )
      .setColor(PURPLE)
      .setFooter({ text: `${BOT_NAME} raffle #${raffle.id}` });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonIdBuilder.raffleEnter(raffle.id))
        .setLabel("Enter")
        .setEmoji("🎉")
        .setStyle(ButtonStyle.Success),
    );
    return { embed, row };
  }

  static async enter(
    raffle: RaffleRow,
    member: GuildMember,
  ): Promise<EnterResult> {
    if (raffle.endedAt) return { ok: false, reason: "ended" };
    if (raffle.verifiedOnly && !isLinked(member))
      return { ok: false, reason: "not_verified" };

    const inserted = await db
      .insert(giveawayRaffleEntry)
      .values({ raffleId: raffle.id, memberId: member.id })
      .onConflictDoNothing()
      .returning();
    return {
      ok: true,
      fresh: inserted.length > 0,
      entries: await this.entryCount(raffle.id),
    };
  }

  /** Uniform, not score-weighted: a raffle is a lottery, not a second leaderboard. */
  static async drawWinner(
    raffleId: number,
    exclude: string[] = [],
    random = Math.random,
  ): Promise<string | null> {
    const entries = await db.query.giveawayRaffleEntry.findMany({
      where: eq(giveawayRaffleEntry.raffleId, raffleId),
    });
    const pool = entries
      .map((e) => e.memberId)
      .filter((id) => !exclude.includes(id));
    if (!pool.length) return null;
    return pool[Math.floor(random() * pool.length)] ?? null;
  }

  /**
   * The prize itself, not a notification, so this deliberately bypasses
   * DmPreferenceService: a muted notification setting must never silently
   * swallow the thing someone actually won.
   */
  private static async deliver(
    guild: Guild,
    memberId: string,
    raffle: RaffleRow,
    code: string | null,
  ): Promise<boolean> {
    const user = await guild.client.users.fetch(memberId).catch(() => null);
    if (!user) return false;
    const embed = new EmbedBuilder()
      .setTitle(`🎉 You won: ${raffle.prize}`)
      .setDescription(
        [
          `You were drawn in the ${BOT_NAME} raffle in **${guild.name}**.`,
          ...(code
            ? ["", "Your code:", `\`\`\`\n${code}\n\`\`\``]
            : ["", "Staff will be in touch with your prize."]),
        ].join("\n"),
      )
      .setColor(PURPLE)
      .setTimestamp(new Date());
    const sent = await user.send({ embeds: [embed] }).catch((e) => {
      logger.warn("Raffle DM failed", {
        raffle: raffle.id,
        member: memberId,
        error: String(e),
      });
      return null;
    });
    return Boolean(sent);
  }

  /** Draw, deliver, announce, close. */
  static async end(
    guild: Guild,
    raffle: RaffleRow,
  ): Promise<{ memberId: string; dmSent: boolean } | null> {
    const endedAt = new Date().toISOString();
    const winnerId = await this.drawWinner(raffle.id);

    if (!winnerId) {
      await db
        .update(giveawayRaffle)
        .set({ endedAt })
        .where(eq(giveawayRaffle.id, raffle.id));
      await this.announceNoEntries(guild, raffle);
      logger.info("Raffle ended with no entries", { raffle: raffle.id });
      return null;
    }

    const dmSent = await this.deliver(guild, winnerId, raffle, raffle.code);
    await db.insert(giveawayRaffleWinner).values({
      raffleId: raffle.id,
      memberId: winnerId,
      code: raffle.code,
      dmSent,
    });
    await db
      .update(giveawayRaffle)
      .set({ endedAt })
      .where(eq(giveawayRaffle.id, raffle.id));

    await this.announceWinner(guild, raffle, winnerId, dmSent);
    logger.info("Raffle ended", { raffle: raffle.id, winner: winnerId, dmSent });
    return { memberId: winnerId, dmSent };
  }

  /**
   * Redraw excluding everyone already drawn. The first winner has had the
   * original code since the draw, so a reroll needs a fresh one.
   */
  static async reroll(
    guild: Guild,
    raffle: RaffleRow,
    newCode: string | null,
  ): Promise<{ memberId: string; dmSent: boolean } | null> {
    const previous = await db.query.giveawayRaffleWinner.findMany({
      where: eq(giveawayRaffleWinner.raffleId, raffle.id),
    });
    const winnerId = await this.drawWinner(
      raffle.id,
      previous.map((w) => w.memberId),
    );
    if (!winnerId) return null;

    const dmSent = await this.deliver(guild, winnerId, raffle, newCode);
    await db.insert(giveawayRaffleWinner).values({
      raffleId: raffle.id,
      memberId: winnerId,
      code: newCode,
      dmSent,
      rerolledFrom: previous[previous.length - 1]?.id ?? null,
    });
    await this.announceWinner(guild, raffle, winnerId, dmSent, true);
    logger.info("Raffle rerolled", { raffle: raffle.id, winner: winnerId });
    return { memberId: winnerId, dmSent };
  }

  private static async announceWinner(
    guild: Guild,
    raffle: RaffleRow,
    winnerId: string,
    dmSent: boolean,
    rerolled = false,
  ): Promise<void> {
    const channel = this.channel(guild);
    if (!channel) return;
    const names = await GiveawayService.displayNames([winnerId], guild);
    const embed = new EmbedBuilder()
      .setTitle(rerolled ? `🎲 Reroll: ${raffle.prize}` : `🎉 ${raffle.prize}`)
      .setDescription(
        [
          `Winner: ${names.get(winnerId)}`,
          "",
          // Surfaced rather than swallowed: closed DMs are the one failure a
          // mod has to fix by hand, and it is invisible otherwise.
          dmSent
            ? "The prize has been sent by DM."
            : "**Could not DM the winner** (DMs closed) - staff will hand the prize over.",
        ].join("\n"),
      )
      .setColor(PURPLE)
      .setFooter({ text: `${BOT_NAME} raffle #${raffle.id}` })
      .setTimestamp(new Date());
    await channel
      .send({ embeds: [embed], allowedMentions: { users: [winnerId] } })
      .catch((e) =>
        logger.error("Raffle winner post failed", {
          raffle: raffle.id,
          error: String(e),
        }),
      );
  }

  private static async announceNoEntries(
    guild: Guild,
    raffle: RaffleRow,
  ): Promise<void> {
    const channel = this.channel(guild);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle(`🎁 ${raffle.prize}`)
      .setDescription("Nobody entered, so there is no winner.")
      .setColor(PURPLE)
      .setFooter({ text: `${BOT_NAME} raffle #${raffle.id}` });
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** Close every raffle past its end time. Runs on the giveaway cron tick. */
  static async sweepExpired(guild: Guild): Promise<void> {
    const due = await db.query.giveawayRaffle.findMany({
      where: and(
        eq(giveawayRaffle.guildId, guild.id),
        isNull(giveawayRaffle.endedAt),
        lte(giveawayRaffle.endsAt, new Date().toISOString()),
      ),
    });
    for (const raffle of due) {
      await this.end(guild, raffle).catch((e) =>
        logger.error("Raffle end failed", {
          raffle: raffle.id,
          error: String(e),
        }),
      );
    }
  }

  /** Entry counts for a set of raffles, for /raffle-list. */
  static async entryCounts(raffleIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (!raffleIds.length) return counts;
    const rows = await db
      .select({
        raffleId: giveawayRaffleEntry.raffleId,
        count: sql<number>`count(*)::int`,
      })
      .from(giveawayRaffleEntry)
      .where(inArray(giveawayRaffleEntry.raffleId, raffleIds))
      .groupBy(giveawayRaffleEntry.raffleId);
    for (const row of rows) counts.set(row.raffleId, row.count);
    return counts;
  }
}
