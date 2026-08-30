import { ExpressionHarvestService } from "@/core/services/expressions/expression-harvest.service";
import { ExpressionUsageService } from "@/core/services/expressions/expression-usage.service";
import { isStaff } from "@/core/utils/command.utils";
import { ChannelType, type GuildMember, type Message } from "discord.js";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

const DEFAULT_PER_CHANNEL = 2000;
// Discord rate-limits message edits; anything faster just gets queued.
const EDIT_INTERVAL_MS = 3000;

function throttledEditor(notice: Message) {
  let last = 0;
  let pending: string | null = null;
  return {
    push(text: string) {
      pending = text;
      const now = Date.now();
      if (now - last < EDIT_INTERVAL_MS) return;
      last = now;
      void notice.edit(text).catch(() => {});
    },
    async flush() {
      if (pending) await notice.edit(pending).catch(() => {});
    },
  };
}

@Discord()
export class ExpressionHarvest {
  /**
   * Adopt custom emoji and stickers members use here but the server does not
   * own. `!emoji-harvest [perChannel]`
   */
  @SimpleCommand({ aliases: ["emoji-harvest"], prefix: "!" })
  async harvest(command: SimpleCommandMessage) {
    const message = command.message;
    if (!message.guild || !isStaff(message.member as GuildMember | null)) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const perChannel =
      message.content
        .trim()
        .split(/\s+/)
        .slice(1)
        .map(Number)
        .find((n) => Number.isFinite(n) && n > 0) ?? DEFAULT_PER_CHANNEL;

    const notice = await message.reply("Scanning...");
    const editor = throttledEditor(notice);

    const scan = await ExpressionHarvestService.scan(
      message.guild,
      perChannel,
      (done, total, messages) =>
        editor.push(
          `Scanning **${done}/${total}** channels, **${messages}** messages read...`,
        ),
    );
    const room = ExpressionHarvestService.capacity(message.guild);
    const backfilled = await ExpressionUsageService.backfill(
      message.guild,
      scan.owned,
    );

    const header = [
      `Scanned **${scan.messagesScanned}** messages in **${scan.channelsScanned}** channels.`,
      `Found **${scan.emojis.length}** external emoji and **${scan.stickers.length}** stickers not owned here.`,
      `Room for **${room.emoji}** emoji and **${room.sticker}** stickers.`,
      `Backfilled usage counts for **${backfilled}** owned expressions.`,
    ].join("\n");

    if (!scan.emojis.length && !scan.stickers.length) {
      await notice.edit(`${header}\n\nNothing new to adopt.`);
      return;
    }

    const result = await ExpressionHarvestService.upload(
      message.guild,
      scan,
      (done, total, label) =>
        editor.push(`${header}\n\nUploading **${done}/${total}**: ${label}`),
    );
    await editor.flush();

    const reasons = new Map<string, number>();
    for (const s of result.skipped)
      reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);

    await notice.edit(
      [
        header,
        "",
        `Added **${result.uploadedEmojis.length}** emoji and **${result.uploadedStickers.length}** stickers.`,
        result.uploadedEmojis.length
          ? `Emoji: ${result.uploadedEmojis.join(", ")}`
          : "",
        result.uploadedStickers.length
          ? `Stickers: ${result.uploadedStickers.join(", ")}`
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
