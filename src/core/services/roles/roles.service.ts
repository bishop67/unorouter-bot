import { db } from "@/lib/db";
import { memberRole, memberMessages, role } from "@/lib/db-schema";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { LEVEL_LIST } from "@/shared/config/levels";
import { JAIL, LEVEL_ROLES, STATUS_ROLES } from "@/shared/config/roles";
import type { UpdateDbRolesArgs } from "@/types";
import { Guild, Role } from "discord.js";

export class RolesService {
  static async updateDbRoles(args: UpdateDbRolesArgs) {
    // check if new role was added
    if (
      (args.oldMember.flags.bitfield === 9 &&
        args.newMember.flags.bitfield === 11) ||
      args.oldMember.pending ||
      args.newMember.pending
    )
      return;

    if (args.newRoles.length > args.oldRoles.length) {
      const jailId = args.guildRoles.find((role) => role.name === JAIL)?.id;
      const jailDbRole = args.memberDbRoles.find(
        (dbRole) => dbRole.roleId === jailId,
      );
      if (jailDbRole) return;

      // add or update new role
      const newAddedRole = args.newRoles.filter(
        (role) => !args.oldRoles.includes(role),
      )[0];
      if (!newAddedRole) return;

      const guildId = args.newMember.guild.id;
      const roleData = {
        roleId: newAddedRole.id,
        memberId: args.newMember.id,
        guildId,
      };

      // Role entity is the FK parent for the association row.
      db.insert(role)
        .values({
          roleId: newAddedRole.id,
          guildId,
          name: newAddedRole.name,
          color: newAddedRole.color || null,
          position: newAddedRole.position,
        })
        .onConflictDoUpdate({
          target: role.roleId,
          set: {
            name: sql`excluded.name`,
            color: sql`excluded.color`,
            position: sql`excluded.position`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .then(() =>
          db
            .insert(memberRole)
            .values(roleData)
            .onConflictDoUpdate({
              target: [memberRole.memberId, memberRole.roleId],
              set: roleData,
            }),
        )
        .catch(() => {});
    }
    if (args.newRoles.length < args.oldRoles.length) {
      // get the removed role
      const newRemovedRole = args.oldRoles.find(
        (role) => !args.newRoles.includes(role),
      );

      // if no role was removed return
      if (!newRemovedRole) return;

      // try catch delete removed role from db
      db.delete(memberRole)
        .where(
          and(
            eq(memberRole.memberId, args.newMember.id),
            eq(memberRole.roleId, newRemovedRole.id),
          ),
        )
        .catch(() => {});
    }
  }

  static async updateStatusRoles(args: UpdateDbRolesArgs) {
    // onboarding question bypass
    if (
      (args.oldMember.flags.bitfield === 9 &&
        args.newMember.flags.bitfield === 11) ||
      args.oldMember.pending ||
      args.newMember.pending
    ) {
      const jailDbRole = args.memberDbRoles.find(
        (dbRole) =>
          dbRole.roleId ===
          args.guildRoles.find((role) => role.name === JAIL)?.id,
      );

      if (jailDbRole) {
        for (const role of args.newMember.roles.cache.values()) {
          if (role.name === JAIL) continue;
          await args.newMember.roles.remove(role).catch(() => {});
        }

        if (!args.newMember.roles.cache.some((role) => role.name === JAIL))
          args.newMember.roles.add(jailDbRole.roleId).catch(() => {});

        db.delete(memberRole).where(
          and(
            eq(memberRole.memberId, args.newMember.id),
            eq(memberRole.guildId, args.newMember.guild.id),
            ne(memberRole.roleId, jailDbRole.roleId),
          ),
        );
      }

      return;
    }

    // Only run if user has a new role
    if (args.oldRoles.length >= args.newRoles.length) return;

    const newRoles = args.newRoles.map((role) => role.name);
    const oldRoles = args.oldRoles.map((role) => role.name);
    const newAddedRole = newRoles.find((role) => !oldRoles.includes(role))!;

    if (newAddedRole === JAIL) {
      const jailRole = args.newMember.roles.cache.find(
        (role) => role.name === JAIL,
      );

      args.newMember.roles.cache.forEach(
        (role) =>
          role.name !== JAIL &&
          args.newMember.roles.remove(role).catch(() => {}),
      );

      return await db
        .delete(memberRole)
        .where(
          and(
            eq(memberRole.memberId, args.newMember.id),
            eq(memberRole.guildId, args.newMember.guild.id),
            ne(memberRole.roleId, jailRole?.id ?? ""),
          ),
        );
    }

    // Check if role is a status role; if yes, remove unused status roles
    if (STATUS_ROLES.includes(newAddedRole)) {
      args.newMember.roles.cache.forEach(
        (role) =>
          newAddedRole !== role.name &&
          STATUS_ROLES.includes(role.name) &&
          args.newMember.roles.remove(role),
      );
    }

    // Check if level roles are added - block self-assigning a level above earned message count
    if (LEVEL_ROLES.includes(newAddedRole)) {
      const levelRole = LEVEL_LIST.find((role) => role.role === newAddedRole);
      if (!levelRole) return;

      const [result] = await db
        .select({ count: count() })
        .from(memberMessages)
        .where(
          and(
            eq(memberMessages.memberId, args.newMember?.id),
            eq(memberMessages.guildId, args.newMember?.guild?.id),
          ),
        );

      const memberMessagesCount = result?.count ?? 0;
      const role = args.newMember.guild.roles.cache.find(
        (role) => role.name === newAddedRole,
      );
      if (memberMessagesCount < levelRole.count && role) {
        args.newMember.roles.remove(role);
      }
    }
  }

  static getGuildStatusRoles(guild: Guild) {
    const guildStatusRoles: { [x: string]: Role | undefined } = {};
    for (const role of STATUS_ROLES)
      guildStatusRoles[role] = guild?.roles.cache.find(
        ({ name }) => name === role,
      );
    return guildStatusRoles;
  }
}
