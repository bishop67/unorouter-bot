import {
  ChannelType,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from "discord.js";
import { logger } from "@/lib/logger";

// Channels match by NAME substring so emoji/separator renames
// ("ticket-logs" -> "📄│ticket-logs") keep resolving.
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findChannelByName(
  guild: Guild,
  name: string,
  type?: ChannelType,
): GuildBasedChannel | null {
  if (!name) return null;
  const target = normalize(name);
  const match = guild.channels.cache.find(
    (c) =>
      (type === undefined || c.type === type) &&
      normalize(c.name).includes(target),
  );
  if (!match) {
    logger.warn("findChannelByName: miss", {
      target,
      type,
      cacheSize: guild.channels.cache.size,
      sample: guild.channels.cache
        .filter((c) => type === undefined || c.type === type)
        .map((c) => c.name)
        .slice(0, 10),
    });
  }
  return match ?? null;
}

export function findTextChannel(
  guild: Guild,
  name: string,
): TextChannel | null {
  return (findChannelByName(guild, name, ChannelType.GuildText) as TextChannel) ?? null;
}

export function findCategory(
  guild: Guild,
  name: string,
): CategoryChannel | null {
  return (findChannelByName(guild, name, ChannelType.GuildCategory) as CategoryChannel) ?? null;
}
