import { ModLogService } from "@/core/services/moderation/modlog.service";
import { isModerator } from "@/core/utils/command.utils";
import type { Guild, GuildMember } from "discord.js";

// Rank follows the server's role order; the owner outranks everyone.
function rank(member: GuildMember): number {
  return member.id === member.guild.ownerId
    ? Number.POSITIVE_INFINITY
    : member.roles.highest.position;
}

/**
 * The member who set `targetId`'s standing timeout, when they rank at or above
 * `actorId`. Null when the change is allowed, including when the setter left.
 */
export async function outrankingSetter(
  guild: Guild,
  targetId: string,
  actorId: string,
  setterId?: string | null,
): Promise<GuildMember | null> {
  setterId ??= await ModLogService.timeoutSetter(guild.id, targetId);
  if (!setterId || setterId === actorId) return null;

  const [setter, actor] = await Promise.all([
    guild.members.fetch(setterId).catch(() => null),
    guild.members.fetch(actorId).catch(() => null),
  ]);
  if (!setter || !actor || setter.user.bot) return null;
  return rank(setter) >= rank(actor) ? setter : null;
}

// Why `actor` may not change `target`'s standing timeout, or null when they may.
// Shortening a timeout is the same override as lifting it.
export async function timeoutChangeBlocked(
  target: GuildMember,
  actor: GuildMember,
): Promise<string | null> {
  if (!target.isCommunicationDisabled()) return null;

  const setterId = await ModLogService.timeoutSetter(target.guild.id, target.id);
  if (!setterId)
    return isModerator(actor)
      ? null
      : "That timeout was not set through this bot, so only moderators can change it.";

  const higher = await outrankingSetter(target.guild, target.id, actor.id, setterId);
  return higher
    ? `That timeout was set by ${higher.user.username}, who ranks at or above you, so only someone higher can change it.`
    : null;
}
