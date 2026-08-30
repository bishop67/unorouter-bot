import { createHash } from "crypto";
import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type TextBasedChannel,
} from "discord.js";
import { logger } from "@/lib/logger";

export interface FoundExpression {
  id: string;
  name: string;
  animated: boolean;
  uses: number;
}

export interface FoundSticker {
  id: string;
  name: string;
  formatType: number;
  uses: number;
}

export interface OwnedUsage {
  id: string;
  name: string;
  kind: "emoji" | "sticker";
  messageUses: number;
  reactionUses: number;
}

export interface HarvestScan {
  messagesScanned: number;
  channelsScanned: number;
  emojis: FoundExpression[];
  stickers: FoundSticker[];
  owned: OwnedUsage[];
}

export interface HarvestResult {
  uploadedEmojis: string[];
  uploadedStickers: string[];
  skipped: { name: string; reason: string }[];
}

// Discord caps by boost tier. Uploading past these 400s, so the harvest stops
// rather than hammering a full server.
const EMOJI_CAP = [50, 100, 150, 250];
const STICKER_CAP = [5, 15, 30, 60];

const EMOJI_PATTERN = /<(a?):(\w+):(\d+)>/g;
// Emoji creates are rate limited hard. discord.js queues rather than failing,
// so an unpaced loop just stalls with no error; pacing keeps progress visible.
const UPLOAD_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Lottie stickers are vector JSON; the upload endpoint only takes PNG/APNG/GIF.
const STICKER_FORMAT_LOTTIE = 3;

export class ExpressionHarvestService {
  static capacity(guild: Guild) {
    const tier = guild.premiumTier ?? 0;
    return {
      emoji: (EMOJI_CAP[tier] ?? 50) - guild.emojis.cache.size,
      sticker: (STICKER_CAP[tier] ?? 5) - guild.stickers.cache.size,
    };
  }

  /**
   * Walk every readable text channel and collect custom emoji and stickers the
   * guild does not already own.
   *
   * `perChannel` bounds the walk: full history on a busy server is tens of
   * thousands of requests, and the useful expressions cluster in recent
   * activity anyway.
   */
  static async scan(
    guild: Guild,
    perChannel: number,
    onProgress?: (done: number, total: number, messages: number) => void,
  ): Promise<HarvestScan> {
    const ownedEmoji = new Set(guild.emojis.cache.map((e) => e.id));
    const ownedSticker = new Set(guild.stickers.cache.map((s) => s.id));
    const emojis = new Map<string, FoundExpression>();
    const stickers = new Map<string, FoundSticker>();
    const owned = new Map<string, OwnedUsage>();
    const bumpOwned = (
      id: string,
      name: string,
      kind: "emoji" | "sticker",
      field: "messageUses" | "reactionUses",
      by: number,
    ) => {
      const row =
        owned.get(id) ?? { id, name, kind, messageUses: 0, reactionUses: 0 };
      row[field] += by;
      row.name = name;
      owned.set(id, row);
    };
    let messagesScanned = 0;
    let channelsScanned = 0;

    const me = guild.members.me;
    const canRead = (c: GuildBasedChannel) =>
      !!me &&
      c.permissionsFor(me).has("ViewChannel") &&
      c.permissionsFor(me).has("ReadMessageHistory");

    // Voice channels carry text too, and forums hold their messages ONLY in
    // threads, so a container-type filter would silently skip both.
    const containers = guild.channels.cache.filter(
      (c): c is GuildBasedChannel =>
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildForum,
          ChannelType.GuildMedia,
        ].includes(c.type) && canRead(c),
    );

    const targets: TextBasedChannel[] = [];
    for (const channel of containers.values()) {
      if (channel.isTextBased()) targets.push(channel);
      if (!("threads" in channel)) continue;
      // Archived threads hold the old reactions; a forum post leaves "active"
      // within days, and a forum keeps its messages ONLY in threads.
      const active = await channel.threads.fetchActive().catch(() => null);
      const archived = await channel.threads
        .fetchArchived({ limit: 100 })
        .catch(() => null);
      for (const collection of [active?.threads, archived?.threads]) {
        for (const thread of collection?.values() ?? []) targets.push(thread);
      }
    }

    for (const channel of targets) {
      if (!channel.isTextBased()) continue;
      channelsScanned++;
      onProgress?.(channelsScanned, targets.length, messagesScanned);
      let before: string | undefined;
      let fetched = 0;

      while (fetched < perChannel) {
        const batch = await channel.messages
          .fetch({ limit: 100, ...(before ? { before } : {}) })
          .catch(() => null);
        if (!batch?.size) break;

        for (const message of batch.values()) {
          messagesScanned++;
          // Reaction counts come back on fetched history, so one pass
          // backfills real usage instead of starting every counter at zero.
          for (const reaction of message.reactions.cache.values()) {
            const rid = reaction.emoji.id;
            if (!rid) continue;
            if (ownedEmoji.has(rid)) {
              bumpOwned(
                rid,
                reaction.emoji.name ?? rid,
                "emoji",
                "reactionUses",
                reaction.count,
              );
              continue;
            }
            // An external emoji reacted with but never typed is still in use
            // here, and reactions are the more common way people reach for one.
            const prev = emojis.get(rid);
            if (prev) prev.uses += reaction.count;
            else
              emojis.set(rid, {
                id: rid,
                name: reaction.emoji.name ?? rid,
                animated: reaction.emoji.animated ?? false,
                uses: reaction.count,
              });
          }
          for (const match of message.content.matchAll(EMOJI_PATTERN)) {
            const id = match[3]!;
            if (ownedEmoji.has(id)) {
              bumpOwned(id, match[2]!, "emoji", "messageUses", 1);
              continue;
            }
            const prev = emojis.get(id);
            if (prev) prev.uses++;
            else
              emojis.set(id, {
                id,
                name: match[2]!,
                animated: match[1] === "a",
                uses: 1,
              });
          }
          for (const sticker of message.stickers.values()) {
            if (ownedSticker.has(sticker.id)) {
              bumpOwned(sticker.id, sticker.name, "sticker", "messageUses", 1);
              continue;
            }
            const prev = stickers.get(sticker.id);
            if (prev) prev.uses++;
            else
              stickers.set(sticker.id, {
                id: sticker.id,
                name: sticker.name,
                formatType: sticker.format,
                uses: 1,
              });
          }
        }

        fetched += batch.size;
        before = batch.last()?.id;
        if (batch.size < 100) break;
      }
    }

    const byUses = <T extends { uses: number }>(a: T, b: T) => b.uses - a.uses;
    return {
      messagesScanned,
      channelsScanned,
      emojis: [...emojis.values()].sort(byUses),
      stickers: [...stickers.values()].sort(byUses),
      owned: [...owned.values()],
    };
  }

  private static async download(url: string): Promise<Buffer | null> {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  /** sha256 of every owned emoji, so a re-upload under a new name is caught. */
  private static cdnUrl(id: string, animated: boolean): string {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128&quality=lossless`;
  }

  /**
   * Hash owned emoji through the SAME url the candidates use. imageURL()
   * serves an animated emoji as webp while the harvest downloads gif, so the
   * bytes never matched and every animated emoji was re-uploaded as name_2.
   */
  private static async ownedHashes(guild: Guild): Promise<Set<string>> {
    const hashes = new Set<string>();
    await Promise.all(
      guild.emojis.cache.map(async (e) => {
        const buf = await this.download(this.cdnUrl(e.id, e.animated ?? false));
        if (buf) hashes.add(createHash("sha256").update(buf).digest("hex"));
      }),
    );
    return hashes;
  }

  private static uniqueName(guild: Guild, name: string): string {
    // Discord allows letters, digits and underscore. Stripping by [^\w] alone
    // reduces a fully non-ASCII name to nothing and every one collides on the
    // same generic fallback.
    const clean =
      name
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}_]/gu, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 30) || `e${Date.now().toString(36).slice(-6)}`;
    if (!guild.emojis.cache.some((e) => e.name === clean)) return clean;
    for (let i = 2; i < 100; i++) {
      const candidate = `${clean.slice(0, 27)}_${i}`;
      if (!guild.emojis.cache.some((e) => e.name === candidate)) return candidate;
    }
    return `${clean.slice(0, 24)}_${Date.now() % 10000}`;
  }

  static async upload(
    guild: Guild,
    scan: HarvestScan,
    onProgress?: (done: number, total: number, label: string) => void,
  ): Promise<HarvestResult> {
    const result: HarvestResult = {
      uploadedEmojis: [],
      uploadedStickers: [],
      skipped: [],
    };
    const room = this.capacity(guild);
    const owned = await this.ownedHashes(guild);

    for (const emoji of scan.emojis) {
      // Re-read: the cache grows with each create, so a snapshot taken before
      // the loop stops short of the real cap.
      if (this.capacity(guild).emoji <= 0) {
        result.skipped.push({ name: emoji.name, reason: "no emoji slots left" });
        break;
      }
      const buf = await this.download(this.cdnUrl(emoji.id, emoji.animated));
      if (!buf) {
        result.skipped.push({ name: emoji.name, reason: "download failed" });
        continue;
      }
      const hash = createHash("sha256").update(buf).digest("hex");
      if (owned.has(hash)) {
        result.skipped.push({ name: emoji.name, reason: "same image already owned" });
        continue;
      }
      // 256KB is the hard upload limit; a 128px fetch is normally well under.
      if (buf.length > 256 * 1024) {
        result.skipped.push({ name: emoji.name, reason: "over 256KB" });
        continue;
      }
      const created = await guild.emojis
        .create({
          attachment: buf,
          name: this.uniqueName(guild, emoji.name),
          reason: `harvested from server usage (${emoji.uses} uses)`,
        })
        .catch((e) => {
          logger.error("Emoji harvest upload failed", {
            emoji: emoji.name,
            error: String(e),
          });
          return null;
        });
      if (created) {
        owned.add(hash);
        result.uploadedEmojis.push(created.name ?? emoji.name);
        await sleep(UPLOAD_DELAY_MS);
        onProgress?.(
          result.uploadedEmojis.length,
          Math.min(scan.emojis.length, room.emoji),
          created.name ?? emoji.name,
        );
      } else {
        result.skipped.push({ name: emoji.name, reason: "upload rejected" });
      }
    }

    for (const sticker of scan.stickers) {
      if (this.capacity(guild).sticker <= 0) {
        result.skipped.push({ name: sticker.name, reason: "no sticker slots left" });
        break;
      }
      if (sticker.formatType === STICKER_FORMAT_LOTTIE) {
        result.skipped.push({ name: sticker.name, reason: "lottie, not uploadable" });
        continue;
      }
      const ext = sticker.formatType === 4 ? "gif" : "png";
      const buf = await this.download(
        `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`,
      );
      if (!buf) {
        result.skipped.push({ name: sticker.name, reason: "download failed" });
        continue;
      }
      if (buf.length > 512 * 1024) {
        result.skipped.push({ name: sticker.name, reason: "over 512KB" });
        continue;
      }
      const created = await guild.stickers
        .create({
          file: buf,
          name: sticker.name.slice(0, 30),
          tags: "emoji",
          description: `Harvested from server usage (${sticker.uses} uses)`,
          reason: "harvested from server usage",
        })
        .catch((e) => {
          logger.error("Sticker harvest upload failed", {
            sticker: sticker.name,
            error: String(e),
          });
          return null;
        });
      if (created) {
        result.uploadedStickers.push(created.name);
        await sleep(UPLOAD_DELAY_MS);
      } else {
        result.skipped.push({ name: sticker.name, reason: "upload rejected" });
      }
    }

    return result;
  }
}
