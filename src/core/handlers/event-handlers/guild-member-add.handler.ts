import { db } from "@/lib/db";
import { memberRole, role } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { InviteService } from "@/core/services/invites/invite.service";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { JAIL, VERIFIED } from "@/shared/config/roles";
import { findTextChannel } from "@/shared/utils/channel.utils";
import type { GuildMember } from "discord.js";
import { and, eq } from "drizzle-orm";

const JOIN_EVENTS_CHANNEL_NAME =
  process.env.JOIN_EVENTS_CHANNEL?.trim() || "join-events";

async function postWelcome(member: GuildMember): Promise<void> {
  const channel = findTextChannel(member.guild, JOIN_EVENTS_CHANNEL_NAME);
  if (!channel) return;
  await channel
    .send({
      content: `${member} (${member.user.username}) ${member.displayName} joined the server.`,
      allowedMentions: { parse: [], users: [], roles: [] },
    })
    .catch((e) =>
      logger.error("Join-events welcome post failed", {
        member: member.id,
        error: String(e),
      }),
    );
}

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  // Attribute before anything else: a later join would shift the invite diff.
  await InviteService.recordJoin(member).catch((e) =>
    logger.error("Invite attribution failed", {
      member: member.id,
      error: String(e),
    }),
  );

  // Welcome post in join-events. Native Discord join messages in the system
  // channel are suppressed so this is the only welcome line.
  await postWelcome(member);

  // Read saved roles before any upsert - upsert would overwrite them from the
  // empty live cache on rejoin. Role name comes from the joined role entity.
  const savedRoles = await db
    .select({ roleId: memberRole.roleId, name: role.name })
    .from(memberRole)
    .innerJoin(role, eq(memberRole.roleId, role.roleId))
    .where(
      and(
        eq(memberRole.memberId, member.id),
        eq(memberRole.guildId, member.guild.id),
      ),
    )
    .catch(() => []);

  // FK parents for member_roles writes.
  await MemberDataService.upsertGuild(member.guild);
  await MemberDataService.upsertMemberOnly(member);

  const wasJailed = savedRoles.some((r) => r.name === JAIL);

  if (wasJailed) {
    const jailRole = member.guild.roles.cache.find((r) => r.name === JAIL);
    if (jailRole?.editable) {
      await member.roles.set([jailRole.id], "Re-jailed on rejoin").catch((e) =>
        logger.error("Re-jail on join failed", {
          member: member.id,
          error: String(e),
        }),
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
    (r) => r.name === VERIFIED,
  );
  if (verifiedRole?.editable) restoreIds.add(verifiedRole.id);

  if (restoreIds.size === 0) return;

  await member.roles
    .add([...restoreIds], "Restore roles + auto-verify on join")
    .catch((e) =>
      logger.error("Role restore on join failed", {
        member: member.id,
        error: String(e),
      }),
    );
}
