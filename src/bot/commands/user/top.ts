import { topStatsEmbed } from "@/core/embeds/top-stats.embed";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import {
  inviteJoin,
  inviteSeed,
  member,
  memberMessages,
  rewardGrant,
} from "@/lib/db-schema";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import dayjs from "dayjs";
import { and, count, desc, eq, gte } from "drizzle-orm";

const TOP_LIMIT = 10;

@Discord()
export class TopCommand {
  @Slash({
    name: "top",
    description: "Top message senders and inviters in this server",
    dmPermission: false,
  })
  async top(
    @SlashOption({
      name: "lookback",
      description: "Only count the past N days (default: all time)",
      required: false,
      minValue: 1,
      maxValue: 9999,
      type: ApplicationCommandOptionType.Integer,
    })
    lookback: number = 9999,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;

    const guild = interaction.guild;
    if (!guild) {
      await safeEditReply(interaction, "This command only works in a server.");
      return;
    }

    const since = dayjs().subtract(lookback, "day").toISOString();

    const [topUsers, rankedInviters, seeds, topVoters] = await Promise.all([
      db
        .select({ memberId: memberMessages.memberId, count: count() })
        .from(memberMessages)
        .innerJoin(member, eq(member.memberId, memberMessages.memberId))
        .where(
          and(
            eq(memberMessages.guildId, guild.id),
            gte(memberMessages.createdAt, since),
            eq(member.bot, false),
          ),
        )
        .groupBy(memberMessages.memberId)
        .orderBy(desc(count()))
        .limit(TOP_LIMIT),
      db
        .select({ memberId: inviteJoin.inviterId, count: count() })
        .from(inviteJoin)
        .where(
          and(
            eq(inviteJoin.guildId, guild.id),
            gte(inviteJoin.createdAt, since),
          ),
        )
        .groupBy(inviteJoin.inviterId),
      // Pre-tracking baseline only makes sense for the all-time window.
      lookback >= 9999
        ? db
            .select({ inviterId: inviteSeed.inviterId, uses: inviteSeed.uses })
            .from(inviteSeed)
            .where(eq(inviteSeed.guildId, guild.id))
        : Promise.resolve([]),
      // Vote grants carry no guildId; rewarded votes are guild-agnostic.
      db
        .select({ memberId: rewardGrant.targetMemberId, count: count() })
        .from(rewardGrant)
        .where(
          and(
            eq(rewardGrant.sourceType, "vote"),
            gte(rewardGrant.createdAt, since),
          ),
        )
        .groupBy(rewardGrant.targetMemberId)
        .orderBy(desc(count()))
        .limit(TOP_LIMIT),
    ]);

    const inviteTotals = new Map<string, number>();
    for (const row of rankedInviters) {
      inviteTotals.set(row.memberId, row.count);
    }
    for (const seed of seeds) {
      inviteTotals.set(
        seed.inviterId,
        (inviteTotals.get(seed.inviterId) ?? 0) + seed.uses,
      );
    }
    const topInviters = [...inviteTotals]
      .map(([memberId, cnt]) => ({ memberId, count: cnt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_LIMIT);

    await safeEditReply(interaction, {
      embeds: [topStatsEmbed({ lookback, topUsers, topInviters, topVoters })],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
