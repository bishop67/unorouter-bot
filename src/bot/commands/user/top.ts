import { topStatsEmbed } from "@/core/embeds/top-stats.embed";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { inviteJoin, member, memberMessages } from "@/lib/db-schema";
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

    const [topUsers, topInviters] = await Promise.all([
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
        .groupBy(inviteJoin.inviterId)
        .orderBy(desc(count()))
        .limit(TOP_LIMIT),
    ]);

    await safeEditReply(interaction, {
      embeds: [topStatsEmbed({ lookback, topUsers, topInviters })],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
