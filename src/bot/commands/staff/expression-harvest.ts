import { ExpressionHarvestService } from "@/core/services/expressions/expression-harvest.service";
import { isStaff } from "@/core/utils/command.utils";
import { ChannelType, type GuildMember } from "discord.js";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

const DEFAULT_PER_CHANNEL = 2000;

@Discord()
export class ExpressionHarvest {
  /**
   * Adopt custom emoji and stickers members use here but the server does not
   * own. Dry run unless "confirm" is passed, because uploads consume finite
   * slots and each one has to be deleted by hand to undo.
   *
   * `!emoji-harvest [confirm] [perChannel]`
   */
  @SimpleCommand({ aliases: ["emoji-harvest"], prefix: "!" })
  async harvest(command: SimpleCommandMessage) {
    const message = command.message;
    if (!message.guild || !isStaff(message.member as GuildMember | null)) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const args = message.content.trim().split(/\s+/).slice(1);
    const confirm = args.includes("confirm");
    const perChannel =
      args.map(Number).find((n) => Number.isFinite(n) && n > 0) ??
      DEFAULT_PER_CHANNEL;

    const notice = await message.reply(
      `Scanning up to ${perChannel} messages per channel...`,
    );

    const scan = await ExpressionHarvestService.scan(message.guild, perChannel);
    const room = ExpressionHarvestService.capacity(message.guild);
    const top = (list: { name: string; uses: number }[]) =>
      list
        .slice(0, 15)
        .map((e) => `${e.name} (${e.uses})`)
        .join(", ") || "none";

    const summary = [
      `Scanned **${scan.messagesScanned}** messages in **${scan.channelsScanned}** channels.`,
      `Found **${scan.emojis.length}** external emoji and **${scan.stickers.length}** stickers not owned here.`,
      `Room for **${room.emoji}** emoji and **${room.sticker}** stickers.`,
      "",
      `Emoji: ${top(scan.emojis)}`,
      `Stickers: ${top(scan.stickers)}`,
    ];

    if (!confirm) {
      summary.push(
        "",
        "Dry run. Re-run with `!emoji-harvest confirm` to upload.",
      );
      await notice.edit(summary.join("\n"));
      return;
    }

    await notice.edit([...summary, "", "Uploading..."].join("\n"));
    const result = await ExpressionHarvestService.upload(message.guild, scan);

    const reasons = new Map<string, number>();
    for (const s of result.skipped)
      reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);

    await notice.edit(
      [
        ...summary,
        "",
        `Uploaded **${result.uploadedEmojis.length}** emoji and **${result.uploadedStickers.length}** stickers.`,
        result.uploadedEmojis.length
          ? `Added: ${result.uploadedEmojis.join(", ")}`
          : "",
        reasons.size
          ? `Skipped: ${[...reasons].map(([r, n]) => `${n} ${r}`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1900),
    );
  }
}
