import type { GuildMember, PartialGuildMember } from "discord.js";
import { EVERYONE } from "@/shared/config/roles";
import { RolesService } from "@/core/services/roles/roles.service";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { BoostService } from "@/core/services/boost/boost.service";
import { VoteService } from "@/core/services/vote/vote.service";
import { db } from "@/lib/db";
import { memberRole } from "@/lib/db-schema";
import { and, eq } from "drizzle-orm";

export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  await syncRoles(oldMember, newMember);

  // Discords.com and Discadia have no vote webhook; their dashboards add a
  // configured role on each upvote. Treat that role-add as the vote signal.
  await VoteService.handleVoteRole(oldMember, newMember);

  // Boost cancellation: premiumSince transitions set -> null when the user drops
  // all their boosts. Deactivate every active slot so the monthly cron stops
  // paying them. New boosts and renewals are picked up via messageCreate on the
  // PREMIUM_GUILD_SUBSCRIPTION system message instead, so we ignore null->set.
  if (oldMember.premiumSince && !newMember.premiumSince) {
    await BoostService.handleBoostCancelled(newMember);
  }
}

async function syncRoles(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  // FK parents for the member_roles writes below.
  await MemberDataService.upsertGuild(newMember.guild);
  await MemberDataService.upsertMemberOnly(newMember);

  const guildRoles = newMember.guild.roles.cache;
  const memberDbRoles = await db.query.memberRole.findMany({
    where: and(
      eq(memberRole.memberId, newMember.id),
      eq(memberRole.guildId, newMember.guild.id),
    ),
  });

  const oldRoles = oldMember.roles.cache
    .filter(({ name }) => name !== EVERYONE)
    .map((role) => role);

  const newRoles = newMember.roles.cache
    .filter(({ name }) => name !== EVERYONE)
    .map((role) => role);

  await RolesService.updateDbRoles({
    oldMember,
    newMember,
    oldRoles,
    newRoles,
    guildRoles,
    memberDbRoles,
  });

  await RolesService.updateStatusRoles({
    oldMember,
    newMember,
    oldRoles,
    newRoles,
    guildRoles,
    memberDbRoles,
  });
}
