import { db } from "@/lib/db";
import { guild, member, memberGuild, memberRole, role } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { MEMBERS_COUNT_CHANNELS } from "@/shared/config/features";
import { EVERYONE } from "@/shared/config/roles";
import {
  generateChart,
  type ChartDataPoint,
} from "@/shared/utils/chart.utils";
import { and, eq, sql } from "drizzle-orm";
import dayjs from "dayjs";
import type { Guild, GuildMember, User } from "discord.js";

export type MemberFlowStats = {
  buffer: Buffer;
  fileName: string;
  memberCount: number;
  botCount: number;
  thirtyDaysCount: number;
  sevenDaysCount: number;
  oneDayCount: number;
  lookback: number;
};

function daysArray(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
    out.push(new Date(d));
  return out;
}

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

  // Renames each MEMBERS_COUNT_CHANNELS channel to "<name> <non-bot count>", so a
  // locked voice channel like "members:" shows the live human count. Discord caps
  // channel renames at 2/10min per channel - joins/leaves beyond that are dropped
  // silently until the window frees, which is fine for a rough live counter.
  static async updateMemberCount(g: Guild): Promise<void> {
    if (MEMBERS_COUNT_CHANNELS.length === 0) return;
    try {
      await g.members.fetch();
    } catch {
      // rate limited - fall back to cache
    }
    const count = g.members.cache.filter((m) => !m.user.bot).size;
    for (const channelName of MEMBERS_COUNT_CHANNELS) {
      const channel = g.channels.cache.find((c) => c.name.includes(channelName));
      if (!channel) continue;
      await channel
        .setName(`${channelName} ${count}`)
        .catch((e) =>
          logger.error("Member-count channel rename failed", {
            channel: channelName,
            error: String(e),
          }),
        );
    }
  }

  // Builds the cumulative member-growth series from live join dates and a
  // QuickChart-rendered PNG, plus human/bot counts and 30d/7d/24h memberflow.
  // Uses Discord's live joinedAt (not DB history) so it works standalone.
  static async memberFlowStats(g: Guild): Promise<MemberFlowStats | null> {
    let members;
    try {
      members = await g.members.fetch();
    } catch {
      members = g.members.cache;
    }

    let memberCount = 0;
    let botCount = 0;
    for (const m of members.values()) {
      if (m.user.bot) botCount++;
      else memberCount++;
    }

    const dates = members
      .filter((m) => !m.user.bot)
      .map((m) => m.joinedAt ?? new Date())
      .sort((a, b) => a.getTime() - b.getTime());
    if (!dates[0]) return null;

    const days = daysArray(dates[0], dayjs().add(1, "day").toDate());
    const data: ChartDataPoint[] = [];
    let ptr = 0;
    for (const day of days) {
      const cur = dayjs(day);
      while (ptr < dates.length && dayjs(dates[ptr]) <= cur) ptr++;
      data.push({ x: cur.toDate(), y: ptr });
    }

    const last = data[data.length - 1]?.y ?? 0;
    const thirtyDaysCount =
      data.length > 31 ? last - data[data.length - 30]!.y : last;
    const sevenDaysCount =
      data.length > 8 ? last - data[data.length - 7]!.y : last;
    const oneDayCount =
      data.length > 3 ? last - data[data.length - 2]!.y : last;

    const lookback = 9999;
    const slice = data.length - 2 < lookback ? 0 : -lookback;
    const buffer = await generateChart(data.slice(slice));

    return {
      buffer,
      fileName: `${g.id}.png`,
      memberCount,
      botCount,
      thirtyDaysCount,
      sevenDaysCount,
      oneDayCount,
      lookback,
    };
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
