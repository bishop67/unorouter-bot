import { BoostService } from "@/core/services/boost/boost.service";
import { isStaff } from "@/core/utils/command.utils";
import { formatDollars } from "@/shared/config/rewards";
import { ChannelType, type GuildMember } from "discord.js";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

@Discord()
export class BoostBackfill {
  /**
   * Pay boosters the bot never recorded. Dry run unless "confirm" is passed:
   * the retro grant is a lump sum and cannot be reversed, so the totals are
   * always shown before any money moves.
   */
  @SimpleCommand({ aliases: ["boost-backfill"], prefix: "!" })
  async boostBackfill(command: SimpleCommandMessage) {
    const message = command.message;
    if (!message.guild || !isStaff(message.member as GuildMember | null)) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const dryRun = !/\bconfirm\b/i.test(message.content);
    await message.guild.members.fetch();
    const progress = await message.channel.send(
      dryRun ? "Boost backfill (dry run)..." : "Boost backfill (LIVE)...",
    );

    const summary = await BoostService.backfillGuild(message.guild, { dryRun });
    // Retro grants are attempted once and never retried, so a refusal has to be
    // named here or it is lost.
    const unpaid = summary.unpaid.length
      ? [
          "",
          `**Unpaid (needs manual /grant): ${summary.unpaid.length}**`,
          ...summary.unpaid.map(
            (u) => `- <@${u.memberId}> $${formatDollars(u.dollars)} (${u.reason})`,
          ),
        ]
      : [];

    await progress.edit({
      content: [
        dryRun ? "**Dry run** - nothing paid." : "**Live run** - grants issued.",
        `Boosters missing a slot: **${summary.created}**`,
        `Already tracked (skipped): **${summary.skipped}**`,
        `Retro months paid: **${summary.retroMonths}**`,
        `Retro payout total: **$${formatDollars(summary.retroDollars)}**`,
        ...unpaid,
        dryRun ? "\nRun `!boost-backfill confirm` to apply." : "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedMentions: { users: [], roles: [] },
    });
  }
}
