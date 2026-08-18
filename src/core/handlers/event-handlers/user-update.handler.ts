import { ServerTagService } from "@/core/services/server-tag/server-tag.service";
import { logger } from "@/lib/logger";
import type { PartialUser, User } from "discord.js";

/**
 * Server tag changes arrive HERE, not on guildMemberUpdate.
 *
 * The gateway does send primary_guild inside GUILD_MEMBER_UPDATE, but discord.js
 * routes a change to the nested user object to `userUpdate` instead, so a
 * guildMemberUpdate listener never sees a tag being put on or taken off. That is
 * why tag state only ever converged on the hourly reconcile.
 *
 * userUpdate is global rather than per-guild, so the member has to be resolved
 * in each guild the bot shares with them.
 */
export async function handleUserUpdate(
  oldUser: User | PartialUser,
  newUser: User,
): Promise<void> {
  if (newUser.bot) return;

  const before = oldUser.partial ? null : oldUser.primaryGuild;
  const after = newUser.primaryGuild;
  if (
    before?.identityGuildId === after?.identityGuildId &&
    before?.identityEnabled === after?.identityEnabled
  ) {
    return;
  }

  for (const guild of newUser.client.guilds.cache.values()) {
    const member =
      guild.members.cache.get(newUser.id) ??
      (await guild.members.fetch(newUser.id).catch(() => null));
    if (!member) continue;
    await ServerTagService.handleTagChanged(member, member).catch((e) =>
      logger.error("Server tag user update failed", {
        member: newUser.id,
        guild: guild.id,
        error: String(e),
      }),
    );
  }
}
