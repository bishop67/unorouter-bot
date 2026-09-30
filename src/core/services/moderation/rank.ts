import { ModLogService } from "@/core/services/moderation/modlog.service";
import { isAdmin, isHelper, isModerator } from "@/core/utils/command.utils";
import type { Guild, GuildMember } from "discord.js";

// Rank follows the staff tier the role names put someone in, not the role
// order, so a cosmetic role sitting above Helper changes nothing. Admin is the
// top rank; the server owner counts as an admin.
function tier(member: GuildMember): number {
  if (member.id === member.guild.ownerId || isAdmin(member)) return 3;
  if (isModerator(member)) return 2;
  if (isHelper(member)) return 1;
  return 0;
}

/**
 * The member behind a standing timeout or jail, when they sit in a higher tier
 * than `actorId`. Peers may undo each other. Null when the change is allowed,
 * including when the setter left.
 */
export async function outrankingSetter(
  guild: Guild,
  setterId: string | null,
  actorId: string,
): Promise<GuildMember | null> {
  if (!setterId || setterId === actorId) return null;

  const [setter, actor] = await Promise.all([
    guild.members.fetch(setterId).catch(() => null),
    guild.members.fetch(actorId).catch(() => null),
  ]);
  if (!setter || !actor || setter.user.bot) return null;
  return tier(setter) > tier(actor) ? setter : null;
}

const outranked = (setter: GuildMember, what: string) =>
  `That ${what} was set by ${setter.user.username}, who ranks above you, so only someone of their rank or higher can change it.`;

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

  const higher = await outrankingSetter(target.guild, setterId, actor.id);
  return higher ? outranked(higher, "timeout") : null;
}

// Why `actor` may not release `target` from jail, or null when they may.
export async function unjailBlocked(
  target: GuildMember,
  actor: GuildMember,
): Promise<string | null> {
  const setterId = await ModLogService.jailSetter(target.guild.id, target.id);
  const higher = await outrankingSetter(target.guild, setterId, actor.id);
  return higher ? outranked(higher, "jail") : null;
}
