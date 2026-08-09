import {
  dollarsToQuota,
  formatDollars,
} from "@/shared/config/rewards";
import { GrantService } from "@/core/services/grant/grant.service";
import { db } from "@/lib/db";
import {
  boostSlot,
  channel,
  giveawayEntry,
  giveawayRound,
  giveawayWinner,
  member as memberTable,
  memberMessages,
  rewardGrant,
  serverTagWear,
} from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import {
  capPoints,
  GIVEAWAY_ANNOUNCE_CHANNEL,
  GIVEAWAY_AUTO_REPEAT,
  GIVEAWAY_CRON_INTERVAL_MS,
  GIVEAWAY_ENABLED,
  GIVEAWAY_ROUND_DAYS,
  GIVEAWAY_EXCLUDED_CHANNELS,
  GIVEAWAY_EXCLUDED_ROLES,
  GIVEAWAY_MESSAGE_COOLDOWN_SECONDS,
  GIVEAWAY_MIN_MESSAGE_LENGTH,
  GIVEAWAY_PRIZES,
  GIVEAWAY_RANKED_COUNT,
  GIVEAWAY_WEIGHTS,
  type GiveawaySignal,
} from "@/shared/config/giveaway";
import { EmbedBuilder, type Client, type Guild, type TextChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { findTextChannel } from "@/shared/utils/channel.utils";
import { ButtonId } from "@/types/custom-ids";
import { BOT_NAME } from "@/shared/config/branding";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

export type Breakdown = Partial<Record<GiveawaySignal, number>>;

export type Scored = {
  memberId: string;
  score: number;
  breakdown: Breakdown;
};

export type DrawnWinner = Scored & {
  place: number;
  kind: "ranked" | "random";
  dollars: number;
  paid?: boolean;
};

type RoundRow = typeof giveawayRound.$inferSelect;

export class GiveawayService {
  static isEnabled(): boolean {
    return GIVEAWAY_ENABLED;
  }

  static async openRound(guildId: string): Promise<RoundRow | null> {
    return (
      (await db.query.giveawayRound.findFirst({
        where: and(
          eq(giveawayRound.guildId, guildId),
          isNull(giveawayRound.endedAt),
        ),
      })) ?? null
    );
  }

  /** `startedByMemberId` is null for cron-opened rounds: it FKs to members, and
   * a sentinel like "system" has no row to point at. */
  static async startRound(
    guild: Guild,
    startedByMemberId: string | null,
  ): Promise<RoundRow | null> {
    if (await this.openRound(guild.id)) return null;
    const rows = await db
      .insert(giveawayRound)
      .values({
        guildId: guild.id,
        startedByMemberId,
        prizePool: JSON.stringify(GIVEAWAY_PRIZES),
      })
      .returning();
    logger.info("Giveaway round started", {
      guild: guild.id,
      round: rows[0]?.id,
    });
    return rows[0] ?? null;
  }

  /**
   * Score every eligible member over the round's window.
   *
   * Eligibility is a `connect` grant: linking is what the verify panel pays for,
   * it is already required to RECEIVE balance, and it removes alt accounts for
   * free. Scoring is multi-signal because most of the people supporting this
   * server never post - a majority of voters and tag wearers have zero messages,
   * so a message-only score would ignore them entirely.
   */
  static async scoreRound(
    round: RoundRow,
    guild?: Guild,
  ): Promise<Scored[]> {
    const from = round.startedAt;
    const to = round.endedAt ?? new Date().toISOString();
    const w = GIVEAWAY_WEIGHTS;

    const excluded = GIVEAWAY_EXCLUDED_CHANNELS;
    const excludedFilter = excluded.length
      ? sql`AND NOT EXISTS (
            SELECT 1 FROM ${channel} c
            WHERE c.channel_id = mm.channel_id
              AND lower(coalesce(c.name, '')) LIKE ANY (ARRAY[${sql.join(
                excluded.map((name) => sql`${`%${name}%`}`),
                sql`, `,
              )}])
          )`
      : sql``;

    // One statement so a round is scored atomically and the weights stay in one
    // place. Messages are de-duped into cooldown buckets rather than counted raw:
    // counting rows lets one member farm the board with one-word spam.
    const rows = await db.execute<{
      member_id: string;
      votes: number;
      invites: number;
      levels: number;
      messages: number;
      tag: number;
      boost: number;
    }>(sql`
      WITH eligible AS (
        SELECT DISTINCT target_member_id AS member_id
        FROM ${rewardGrant}
        WHERE source_type = 'connect'
      ),
      grants AS (
        SELECT target_member_id AS member_id,
               count(*) FILTER (WHERE source_type = 'vote')   AS votes,
               count(*) FILTER (WHERE source_type = 'invite') AS invites,
               count(*) FILTER (WHERE source_type = 'level')  AS levels
        FROM ${rewardGrant}
        WHERE created_at >= ${from} AND created_at < ${to}
        GROUP BY target_member_id
      ),
      msgs AS (
        -- Bucket by cooldown window so a burst of messages scores once.
        SELECT mm.member_id,
               count(DISTINCT floor(
                 extract(epoch FROM mm.created_at)
                 / ${GIVEAWAY_MESSAGE_COOLDOWN_SECONDS}
               )) AS messages
        FROM ${memberMessages} mm
        WHERE mm.created_at >= ${from} AND mm.created_at < ${to}
          AND coalesce(mm.content_length, 0) >= ${GIVEAWAY_MIN_MESSAGE_LENGTH}
          ${excludedFilter}
        GROUP BY mm.member_id
      ),
      tagged AS (
        SELECT DISTINCT member_id FROM ${serverTagWear}
        WHERE active AND guild_id = ${round.guildId}
      ),
      boosted AS (
        SELECT DISTINCT member_id FROM ${boostSlot}
        WHERE active AND guild_id = ${round.guildId}
      )
      SELECT e.member_id,
             coalesce(g.votes, 0)::int    AS votes,
             coalesce(g.invites, 0)::int  AS invites,
             coalesce(g.levels, 0)::int   AS levels,
             coalesce(m.messages, 0)::int AS messages,
             (t.member_id IS NOT NULL)::int AS tag,
             (b.member_id IS NOT NULL)::int AS boost
      FROM eligible e
      LEFT JOIN grants  g ON g.member_id = e.member_id
      LEFT JOIN msgs    m ON m.member_id = e.member_id
      LEFT JOIN tagged  t ON t.member_id = e.member_id
      LEFT JOIN boosted b ON b.member_id = e.member_id
    `);

    const scored: Scored[] = [];
    for (const r of rows) {
      const breakdown: Breakdown = {};
      if (r.votes) breakdown.vote = capPoints("vote", r.votes * w.vote);
      if (r.invites) breakdown.invite = capPoints("invite", r.invites * w.invite);
      if (r.levels) breakdown.level = capPoints("level", r.levels * w.level);
      if (r.messages)
        breakdown.message = capPoints("message", r.messages * w.message);
      if (r.tag) breakdown.serverTag = w.serverTag;
      if (r.boost) breakdown.boost = w.boost;

      const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
      if (score > 0) scored.push({ memberId: r.member_id, score, breakdown });
    }

    const filtered = guild ? this.dropExcludedRoles(scored, guild) : scored;
    filtered.sort((a, b) =>
      b.score - a.score || a.memberId.localeCompare(b.memberId),
    );
    return filtered;
  }

  /** Roles are a Discord concept, so this filters after the SQL rather than in it. */
  private static dropExcludedRoles(scored: Scored[], guild: Guild): Scored[] {
    if (!GIVEAWAY_EXCLUDED_ROLES.length) return scored;
    return scored.filter((entry) => {
      const member = guild.members.cache.get(entry.memberId);
      if (!member) return true;
      return !member.roles.cache.some((role) =>
        GIVEAWAY_EXCLUDED_ROLES.includes(role.name),
      );
    });
  }

  /**
   * Top N by score take the ranked prizes; the rest are drawn weighted by score.
   * Weighting keeps participation meaningful without making the draw a second
   * leaderboard - a one-point member still has real odds against a whale.
   */
  static drawWinners(scored: Scored[], random = Math.random): DrawnWinner[] {
    const winners: DrawnWinner[] = [];
    const ranked = scored.slice(0, GIVEAWAY_RANKED_COUNT);
    ranked.forEach((entry, i) => {
      winners.push({
        ...entry,
        place: i + 1,
        kind: "ranked",
        dollars: GIVEAWAY_PRIZES[i]!,
      });
    });

    const pool = scored.slice(GIVEAWAY_RANKED_COUNT);
    for (let i = GIVEAWAY_RANKED_COUNT; i < GIVEAWAY_PRIZES.length; i++) {
      if (!pool.length) break;
      const total = pool.reduce((sum, e) => sum + e.score, 0);
      let ticket = random() * total;
      let idx = pool.findIndex((e) => (ticket -= e.score) < 0);
      if (idx < 0) idx = pool.length - 1;
      const [picked] = pool.splice(idx, 1);
      winners.push({
        ...picked!,
        place: i + 1,
        kind: "random",
        dollars: GIVEAWAY_PRIZES[i]!,
      });
    }
    return winners;
  }

  /** Persist every scoring participant so standings survive the round. */
  static async saveEntries(roundId: number, scored: Scored[]): Promise<void> {
    if (!scored.length) return;
    await db
      .insert(giveawayEntry)
      .values(
        scored.map((e) => ({
          roundId,
          memberId: e.memberId,
          score: e.score,
          breakdown: JSON.stringify(e.breakdown),
        })),
      )
      .onConflictDoNothing();
  }

  static async endRound(
    round: RoundRow,
    guild?: Guild,
  ): Promise<DrawnWinner[]> {
    const endedAt = new Date().toISOString();
    const scored = await this.scoreRound({ ...round, endedAt }, guild);
    await this.saveEntries(round.id, scored);
    const winners = this.drawWinners(scored);

    for (const winner of winners) {
      const quota = dollarsToQuota(winner.dollars);
      let paid = false;
      try {
        const result = await GrantService.grantQuota({
          targetDiscordId: winner.memberId,
          quota,
          reason: `giveaway #${round.id} - place ${winner.place} (${winner.score} pts)`,
          sourceType: "giveaway",
          sourceId: String(round.id),
          grantedByDiscordId: "system",
          checkIpUnique: true,
        });
        paid = result.linked && !result.ipDuplicate;
        if (!paid) {
          logger.warn("Giveaway payout declined", {
            round: round.id,
            member: winner.memberId,
            reason: result.linked ? "ip_duplicate" : "not_linked",
          });
        }
      } catch (err) {
        logger.error("Giveaway payout failed", {
          round: round.id,
          member: winner.memberId,
          error: String(err),
        });
      }
      winner.paid = paid;
      await db
        .insert(giveawayWinner)
        .values({
          roundId: round.id,
          memberId: winner.memberId,
          place: winner.place,
          kind: winner.kind,
          score: winner.score,
          quota,
          paid,
        })
        .onConflictDoNothing();
    }

    await db
      .update(giveawayRound)
      .set({ endedAt })
      .where(eq(giveawayRound.id, round.id));

    logger.info("Giveaway round ended", {
      round: round.id,
      participants: scored.length,
      winners: winners.length,
    });
    return winners;
  }

  /** Live standings for /giveaway status (scored fresh, round still open). */
  static async standings(
    round: RoundRow,
    limit = 10,
    guild?: Guild,
  ): Promise<Scored[]> {
    const scored = await this.scoreRound(round, guild);
    return scored.slice(0, limit);
  }

  static async memberScore(
    round: RoundRow,
    memberId: string,
    guild?: Guild,
  ): Promise<{ entry: Scored | null; place: number; total: number }> {
    const scored = await this.scoreRound(round, guild);
    const idx = scored.findIndex((e) => e.memberId === memberId);
    return {
      entry: idx >= 0 ? scored[idx]! : null,
      place: idx >= 0 ? idx + 1 : 0,
      total: scored.length,
    };
  }

  /** Cross-round history: who wins most, who scores most. */
  static async leaderboard(guildId: string, limit = 10) {
    return db.execute<{
      member_id: string;
      rounds: number;
      total_score: number;
      wins: number;
      total_quota: number;
    }>(sql`
      SELECT e.member_id,
             count(DISTINCT e.round_id)::int AS rounds,
             sum(e.score)::int               AS total_score,
             count(w.id)::int                AS wins,
             coalesce(sum(w.quota), 0)::int  AS total_quota
      FROM ${giveawayEntry} e
      JOIN ${giveawayRound} r ON r.id = e.round_id AND r.guild_id = ${guildId}
      LEFT JOIN ${giveawayWinner} w
        ON w.round_id = e.round_id AND w.member_id = e.member_id
      GROUP BY e.member_id
      ORDER BY wins DESC, total_score DESC
      LIMIT ${limit}
    `);
  }

  /**
   * Mention plus username for a set of ids, matching the join-events format.
   *
   * A bare <@id> renders as "unknown-user" for anyone the viewing client has
   * not cached, and the board is mostly members who vote or wear the tag
   * without ever posting. Keeping the mention makes them clickable where the
   * client can resolve it; the username in parens keeps the line readable
   * where it cannot.
   */
  static async displayNames(
    ids: string[],
    guild?: Guild,
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    if (!ids.length) return labels;

    const usernames = new Map<string, string>();
    const rows = await db
      .select({ id: memberTable.memberId, username: memberTable.username })
      .from(memberTable)
      .where(inArray(memberTable.memberId, ids))
      .catch(() => []);
    for (const row of rows) usernames.set(row.id, row.username);
    if (guild) {
      for (const id of ids) {
        const cached = guild.members.cache.get(id);
        if (cached) usernames.set(id, cached.user.username);
      }
    }

    for (const id of ids) {
      const name = usernames.get(id);
      labels.set(id, name ? `<@${id}> (${name})` : `<@${id}>`);
    }
    return labels;
  }

  static formatBreakdown(breakdown: Breakdown): string {
    const label: Record<GiveawaySignal, string> = {
      invite: "invites",
      boost: "boost",
      serverTag: "server tag",
      level: "levels",
      vote: "votes",
      message: "messages",
    };
    const parts = (Object.keys(breakdown) as GiveawaySignal[])
      .filter((k) => breakdown[k])
      .sort((a, b) => breakdown[b]! - breakdown[a]!)
      .map((k) => `${label[k]} +${breakdown[k]}`);
    return parts.length ? parts.join(", ") : "no points";
  }

  static formatPrize(dollars: number): string {
    return `$${formatDollars(dollars)}`;
  }

  static announceChannel(guild: Guild): TextChannel | null {
    return findTextChannel(guild, GIVEAWAY_ANNOUNCE_CHANNEL);
  }

  static panelEmbed(
    round?: RoundRow,
  ): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
    const w = GIVEAWAY_WEIGHTS;
    // Discord renders these live, so the panel keeps counting down without the
    // bot editing it. Without an end time nobody knows how long they have.
    const endsAt = round
      ? Math.floor(
          (new Date(round.startedAt).getTime() +
            GIVEAWAY_ROUND_DAYS * 86_400_000) /
            1000,
        )
      : null;
    const total = GIVEAWAY_PRIZES.reduce((a, b) => a + b, 0);
    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${BOT_NAME} giveaway is live`)
      .setDescription(
        [
          `**${this.formatPrize(total)}** in balance, split across ${GIVEAWAY_PRIZES.length} winners.`,
          endsAt
            ? `Ends <t:${endsAt}:R> (<t:${endsAt}:f>), then a new round starts automatically.`
            : `Runs for **${GIVEAWAY_ROUND_DAYS} days**, then a new round starts automatically.`,
          "",
          "**You do NOT have to chat to win.** Everything you already do counts:",
          `- Invite someone who joins - **${w.invite} pts**`,
          `- Boost the server - **${w.boost} pts**`,
          `- Wear our server tag - **${w.serverTag} pts**`,
          `- Reach a new level - **${w.level} pts**`,
          `- Vote for us on the listing sites - **${w.vote} pts** each`,
          `- Send a message - **${w.message} pt**`,
          "",
          "**Prizes**",
          GIVEAWAY_PRIZES.map(
            (d, i) =>
              `${i + 1}. ${this.formatPrize(d)}${i < GIVEAWAY_RANKED_COUNT ? "" : " (random draw)"}`,
          ).join("\n"),
          "",
          `Top ${GIVEAWAY_RANKED_COUNT} by points win outright. The rest are drawn at random from everyone who scored, so a few points still gives you a real shot.`,
          "",
          "Use `/giveaway-leaderboard` to see the standings. Verified members only; points reset each round.",
        ].join("\n"),
      )
      .setColor(0x9b59ff);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ButtonId.GiveawayScore)
        .setLabel("My score")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Success),
    );
    return { embed, row };
  }

  static resultsEmbed(
    roundId: number,
    winners: DrawnWinner[],
    names?: Map<string, string>,
  ): EmbedBuilder {
    const medals = ["🥇", "🥈", "🥉"];
    return new EmbedBuilder()
      .setTitle(`🎉 Giveaway results - round #${roundId}`)
      .setDescription(
        [
          ...winners.map((w) => {
            const icon = w.kind === "ranked" ? (medals[w.place - 1] ?? "🏅") : "🎲";
            const tail = w.kind === "ranked" ? "" : " *(random draw)*";
            // Mention the winner (they get pinged) but name them in text too, so
            // the line still reads for viewers who have not cached them.
            const label = names?.get(w.memberId) ?? `<@${w.memberId}>`;
            return `${icon} ${label} - **${this.formatPrize(w.dollars)}** - ${w.score} pts${tail}\n> ${this.formatBreakdown(w.breakdown)}`;
          }),
          "",
          `Top ${GIVEAWAY_RANKED_COUNT} placed by points; the rest were drawn at random from everyone who scored.`,
          "**A new round starts right now** - everything you already do counts toward it.",
        ].join("\n"),
      )
      .setColor(0x9b59ff)
      .setTimestamp(new Date());
  }

  /** Close the round, announce, and immediately open the next one. */
  static async rollRound(guild: Guild): Promise<void> {
    const round = await this.openRound(guild.id);
    if (!round) {
      if (GIVEAWAY_AUTO_REPEAT) await this.openAndAnnounce(guild);
      return;
    }
    const dueAt =
      new Date(round.startedAt).getTime() + GIVEAWAY_ROUND_DAYS * 86_400_000;
    if (Date.now() < dueAt) return;

    await guild.members.fetch().catch(() => null);
    const winners = await this.endRound(round, guild);
    const channel = this.announceChannel(guild);
    if (winners.length && channel) {
      const names = await this.displayNames(winners.map((w) => w.memberId), guild);
      await channel
        .send({ embeds: [this.resultsEmbed(round.id, winners, names)], allowedMentions: { users: [] } })
        .catch((e) => logger.error("Giveaway results post failed", { error: String(e) }));
    }
    logger.info("Giveaway round rolled", { round: round.id, winners: winners.length });
    // Opening the next round must not depend on the announcement succeeding:
    // a channel permission error should not leave the cycle stopped.
    if (GIVEAWAY_AUTO_REPEAT) {
      await this.openAndAnnounce(guild).catch((e) =>
        logger.error("Giveaway next round failed to open", {
          guild: guild.id,
          error: String(e),
        }),
      );
    }
  }

  static async openAndAnnounce(guild: Guild): Promise<void> {
    const next = await this.startRound(guild, null);
    if (!next) return;
    const channel = this.announceChannel(guild);
    if (!channel) return;
    const panel = this.panelEmbed(next);
    await channel
      .send({ embeds: [panel.embed], components: [panel.row] })
      .catch((e) => logger.error("Giveaway panel post failed", { error: String(e) }));
  }

  static startCron(client: Client): void {
    if (!GIVEAWAY_ENABLED) {
      logger.info("Giveaway cron disabled (GIVEAWAY_PRIZES empty)");
      return;
    }
    const tick = async () => {
      for (const guild of client.guilds.cache.values()) {
        await this.rollRound(guild).catch((e) =>
          logger.error("Giveaway cron tick failed", { guild: guild.id, error: String(e) }),
        );
      }
    };
    void tick();
    setInterval(() => void tick(), GIVEAWAY_CRON_INTERVAL_MS);
    logger.info("Giveaway cron started", {
      intervalMs: GIVEAWAY_CRON_INTERVAL_MS,
      roundDays: GIVEAWAY_ROUND_DAYS,
      autoRepeat: GIVEAWAY_AUTO_REPEAT,
    });
  }
}
