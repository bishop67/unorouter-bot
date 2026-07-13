import { db } from "@/lib/db";
import { guild, member, memberGuild, memberRole, role } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { EVERYONE } from "@/shared/config/roles";
import { and, eq, sql } from "drizzle-orm";
import type { Guild, GuildMember, User } from "discord.js";

// Slim port of coding-global's MemberDataService for our smaller schema. Upserts
// `members`, `member_guilds`, and per-member `member_roles` for the current
// guild. Treats network blips + Unknown-Member (10007) as no-ops; loud-logs
// the rest.
export class MemberDataService {
  static async upsertGuild(g: Guild): Promise<void> {
    try {
      await db
        .insert(guild)
        .values({ guildId: g.id, guildName: g.name })
        .onConflictDoUpdate({
          target: guild.guildId,
          set: { guildName: g.name },
        });
    } catch (err) {
      logger.error("Failed to upsert guild", {
        guild: g.id,
        error: String(err),
      });
    }
  }

  // No member_roles touch, unlike updateCompleteMemberData - safe before role
  // restore on rejoin when the role cache is still empty.
  static async upsertMemberOnly(gm: GuildMember): Promise<void> {
    try {
      const memberRow = prepareMember(gm.user);
      const memberGuildRow = prepareMemberGuild(gm);
      await db
        .insert(member)
        .values(memberRow)
        .onConflictDoUpdate({ target: member.memberId, set: memberRow });
      await db
        .insert(memberGuild)
        .values(memberGuildRow)
        .onConflictDoUpdate({
          target: [memberGuild.memberId, memberGuild.guildId],
          set: memberGuildRow,
        });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("Connect Timeout Error")) return;
        if ("code" in err && (err as { code?: number }).code === 10007) return;
      }
      logger.error("Failed to upsert member", {
        memberId: gm.id,
        username: gm.user.username,
        error: String(err),
      });
    }
  }

  static async updateCompleteMemberData(gm: GuildMember): Promise<void> {
    try {
      const memberRow = prepareMember(gm.user);
      const memberGuildRow = prepareMemberGuild(gm);
      const roleEntities = prepareRoleEntities(gm);
      const roleRows = prepareMemberRoles(gm);

      await db
        .insert(member)
        .values(memberRow)
        .onConflictDoUpdate({ target: member.memberId, set: memberRow });

      await Promise.all([
        db
          .insert(memberGuild)
          .values(memberGuildRow)
          .onConflictDoUpdate({
            target: [memberGuild.memberId, memberGuild.guildId],
            set: memberGuildRow,
          }),
        (async () => {
          // Role entities are FK parents for the association rows below.
          if (roleEntities.length > 0) {
            await db
              .insert(role)
              .values(roleEntities)
              .onConflictDoUpdate({
                target: role.roleId,
                set: {
                  name: sql`excluded.name`,
                  color: sql`excluded.color`,
                  position: sql`excluded.position`,
                  updatedAt: sql`CURRENT_TIMESTAMP`,
                },
              });
          }
          await db
            .delete(memberRole)
            .where(
              and(
                eq(memberRole.memberId, gm.id),
                eq(memberRole.guildId, gm.guild.id),
              ),
            );
          if (roleRows.length > 0) {
            await db.insert(memberRole).values(roleRows).onConflictDoNothing();
          }
        })(),
      ]);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("Connect Timeout Error")) return;
        if ("code" in err && (err as { code?: number }).code === 10007) return;
      }
      logger.error("Failed to update complete member data", {
        memberId: gm.id,
        username: gm.user.username,
        error: String(err),
      });
    }
  }
}

function prepareMember(u: User) {
  return {
    memberId: u.id,
    username: u.username,
    globalName: u.globalName,
    avatarUrl: u.avatarURL({ size: 1024 }) || null,
    bannerUrl: u.bannerURL({ size: 1024 }) || null,
    bot: u.bot,
    flags: u.flags?.bitfield ?? null,
    system: u.system,
    createdAt: u.createdAt?.toISOString() ?? null,
  };
}

function prepareMemberGuild(m: GuildMember) {
  return {
    memberId: m.id,
    guildId: m.guild.id,
    status: true,
    nickname: m.nickname,
    joinedAt: m.joinedAt?.toISOString() ?? null,
    premiumSince: m.premiumSince?.toISOString() ?? null,
  };
}

// Role-entity upserts: one `roles` row per held role (attributes live here now).
function prepareRoleEntities(m: GuildMember) {
  return m.roles.cache
    .filter((r) => r.name !== EVERYONE)
    .map((r) => ({
      roleId: r.id,
      guildId: m.guild.id,
      name: r.name,
      color: r.color || null,
      position: r.position,
    }));
}

// Pure member<->role association rows.
function prepareMemberRoles(m: GuildMember) {
  return m.roles.cache
    .filter((r) => r.name !== EVERYONE)
    .map((r) => ({
      roleId: r.id,
      guildId: m.guild.id,
      memberId: m.id,
    }));
}
