import { ModLogService } from "@/core/services/moderation/modlog.service";
import { isModerator } from "@/core/utils/command.utils";
import type { Guild, GuildMember } from "discord.js";

// Rank follows the server's role order, so reordering roles in Discord is all
// it takes to change who may override whose timeout.
function rank(member: GuildMember): number {
  return member.id === member.guild.ownerId
    ? Number.POSITIVE_INFINITY
    : member.roles.highest.position;
}

/**
 * The member who set `targetId`'s standing timeout, when they rank at or above
 * `actorId` and so may only be overridden by someone higher. Null when the
 * change is allowed, including when the setter has left the server.
 */
export async function outrankingSetter(
  guild: Guild,
  targetId: string,
  actorId: string,
): Promise<GuildMember | null> {
  const setterId = await ModLogService.timeoutSetter(guild.id, targetId);
  if (!setterId || setterId === actorId) return null;

  const [setter, actor] = await Promise.all([
    guild.members.fetch(setterId).catch(() => null),
    guild.members.fetch(actorId).catch(() => null),
  ]);
  if (!setter || !actor || setter.user.bot) return null;

  return rank(setter) >= rank(actor) ? setter : null;
}

/**
 * Why `actor` may not change `target`'s standing timeout, or null when they
 * may. Discord's timeout is a single value, so shortening a timeout is the
 * same override as lifting it.
 */
export async function timeoutChangeBlocked(
  target: GuildMember,
  actor: GuildMember,
): Promise<string | null> {
  if (!target.isCommunicationDisabled()) return null;

  const setterId = await ModLogService.timeoutSetter(target.guild.id, target.id);

  // Timeouts from before the mod log existed have no known setter.
  if (!setterId)
    return isModerator(actor)
      ? null
      : "That timeout was not set through this bot, so only moderators can change it.";

  if (setterId === actor.id) return null;

  const setter = await target.guild.members.fetch(setterId).catch(() => null);
  if (!setter) return null;

  if (isModerator(setter) && !isModerator(actor))
    return "Only moderators can change a timeout set by a moderator.";

  const higher = await outrankingSetter(target.guild, target.id, actor.id);
  return higher
    ? `That timeout was set by ${higher.user.username}, who ranks at or above you, so only someone higher can change it.`
    : null;
}
