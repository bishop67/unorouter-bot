import { topStatsEmbed } from "@/core/embeds/top-stats.embed";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberMessages } from "@/lib/db-schema";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { and, count, desc, eq, gte } from "drizzle-orm";

const TOP_LIMIT = 10;

@Discord()
export class TopCommand {
  @Slash({
    name: "top",
    description: "Top message senders and channels in this server",
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

    const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);
    const filters = and(
      eq(memberMessages.guildId, guild.id),
      gte(memberMessages.createdAt, since),
    );

    const [topUsers, topChannels] = await Promise.all([
      db
        .select({ memberId: memberMessages.memberId, count: count() })
        .from(memberMessages)
        .where(filters)
        .groupBy(memberMessages.memberId)
        .orderBy(desc(count()))
        .limit(TOP_LIMIT),
      db
        .select({ channelId: memberMessages.channelId, count: count() })
        .from(memberMessages)
        .where(filters)
        .groupBy(memberMessages.channelId)
        .orderBy(desc(count()))
        .limit(TOP_LIMIT),
    ]);

    await safeEditReply(interaction, {
      embeds: [topStatsEmbed({ lookback, topUsers, topChannels })],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
