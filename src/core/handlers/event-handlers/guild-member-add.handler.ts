import { db } from "@/lib/db";
import { memberRole } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { JAIL, VERIFIED } from "@/shared/config/roles";
import { findTextChannel } from "@/shared/utils/channel.utils";
import type { GuildMember } from "discord.js";
import { and, eq } from "drizzle-orm";

const JOIN_EVENTS_CHANNEL_NAME =
  process.env.JOIN_EVENTS_CHANNEL?.trim() || "join-events";

async function postWelcome(member: GuildMember): Promise<void> {
  const channel = findTextChannel(member.guild, JOIN_EVENTS_CHANNEL_NAME);
  if (!channel) return;
  const globalName = member.user.globalName ?? member.user.username;
  const serverName = member.displayName;
  const names =
    serverName && serverName !== globalName
      ? `${globalName} (${serverName})`
      : globalName;
  await channel
    .send({
      content: `${names} ${member} joined the server.`,
      allowedMentions: { parse: [], users: [], roles: [] }
    })
    .catch((e) =>
      logger.error("Join-events welcome post failed", {
        member: member.id,
        error: String(e)
      })
    );
}

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  // Welcome post in join-events. Native Discord join messages in the system
  // channel are suppressed so this is the only welcome line.
  await postWelcome(member);

  // Restore previously-saved roles (set on guildMemberUpdate). Re-jail if they
  // left while jailed; otherwise reapply saved roles + ensure Verified.
  const savedRoles = await db.query.memberRole
    .findMany({
      where: and(
        eq(memberRole.memberId, member.id),
        eq(memberRole.guildId, member.guild.id)
      )
    })
    .catch(() => []);

  const wasJailed = savedRoles.some((r) => r.name === JAIL);

  if (wasJailed) {
    const jailRole = member.guild.roles.cache.find((r) => r.name === JAIL);
    if (jailRole?.editable) {
      await member.roles.set([jailRole.id], "Re-jailed on rejoin").catch((e) =>
        logger.error("Re-jail on join failed", {
          member: member.id,
          error: String(e)
        })
      );
    }
    return;
  }

  // Roles to reapply: every saved role that still exists, is editable, and is not
  // a restricted/managed role. Always include Verified.
  const restoreIds = new Set<string>();
  for (const saved of savedRoles) {
    const role = member.guild.roles.cache.get(saved.roleId);
    if (role && role.editable && !role.managed) restoreIds.add(role.id);
  }

  const verifiedRole = member.guild.roles.cache.find(
    (r) => r.name === VERIFIED
  );
  if (verifiedRole?.editable) restoreIds.add(verifiedRole.id);

  if (restoreIds.size === 0) return;

  await member.roles
    .add([...restoreIds], "Restore roles + auto-verify on join")
    .catch((e) =>
      logger.error("Role restore on join failed", {
        member: member.id,
        error: String(e)
      })
    );
}
