import { ModLogService } from "@/core/services/moderation/modlog.service";
import { isModerator } from "@/core/utils/command.utils";
import type { Guild, GuildMember } from "discord.js";

const rank = (member: GuildMember) => member.roles.highest.position;

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
  return rank(setter) > rank(actor) ? setter : null;
}

const outranked = (setter: GuildMember, what: string) =>
  `That ${what} was set by ${setter.user.username}, who ranks above you, so only someone of their rank or higher can change it.`;

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

export async function unjailBlocked(
  target: GuildMember,
  actor: GuildMember,
): Promise<string | null> {
  const setterId = await ModLogService.jailSetter(target.guild.id, target.id);
  const higher = await outrankingSetter(target.guild, setterId, actor.id);
  return higher ? outranked(higher, "jail") : null;
}
