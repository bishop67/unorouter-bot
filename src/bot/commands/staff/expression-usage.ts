import { ExpressionUsageService } from "@/core/services/expressions/expression-usage.service";
import { isStaff } from "@/core/utils/command.utils";
import { ChannelType, type GuildMember } from "discord.js";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

@Discord()
export class ExpressionUsage {
  /**
   * Least-used emoji and stickers first, so dead slots can be retired.
   * `!emoji-usage [limit]`
   */
  @SimpleCommand({ aliases: ["emoji-usage"], prefix: "!" })
  async usage(command: SimpleCommandMessage) {
    const message = command.message;
    if (!message.guild || !isStaff(message.member as GuildMember | null)) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const limit =
      message.content
        .trim()
        .split(/\s+/)
        .slice(1)
        .map(Number)
        .find((n) => Number.isFinite(n) && n > 0) ?? 30;

    const all = await ExpressionUsageService.report(message.guild);
    const since = await ExpressionUsageService.trackedSince(message.guild.id);
    const unused = all.filter((e) => e.total === 0);

    const line = (e: (typeof all)[number]) =>
      `${e.kind === "sticker" ? "[s] " : ""}${e.name} - ${e.total}` +
      (e.total ? ` (${e.messageUses}m/${e.reactionUses}r)` : "");

    await message.reply(
      [
        `**${all.length}** expressions tracked, **${unused.length}** unused since ` +
          (since ? `<t:${Math.floor(new Date(since).getTime() / 1000)}:R>` : "tracking began"),
        "",
        `Least used (${Math.min(limit, all.length)}):`,
        all.slice(0, limit).map(line).join("\n"),
        "",
        "Counts start from when tracking shipped, so a zero means unused since then, not never.",
      ]
        .join("\n")
        .slice(0, 1900),
    );
  }
}
