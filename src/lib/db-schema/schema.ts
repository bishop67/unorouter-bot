import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Conventions:
// - Table names: snake_case, plural ("guilds", "members", "tickets").
// - Column names on disk: snake_case ("member_id", "created_at").
// - TS field names: camelCase, mapped via the explicit name in each column().
// - FK constraints: <child_table>_<child_col>_fkey (Drizzle default for .references()).
// - Indexes: idx_<table>_<col[_col]>; unique: uq_<table>_<col[_col]>.
// - Cascade on parent delete by default; restrict only for guild deletion.

const createdAt = () =>
  timestamp("created_at", { precision: 3, mode: "string" })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();

const updatedAt = () =>
  timestamp("updated_at", { precision: 3, mode: "string" })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();

export const guild = pgTable("guilds", {
  guildId: text("guild_id").primaryKey(),
  guildName: text("guild_name").notNull(),
  lookback: integer("lookback").default(9999).notNull(),
});

export const member = pgTable("members", {
  memberId: text("member_id").primaryKey(),
  username: text("username").notNull(),
  globalName: text("global_name"),
  createdAt: timestamp("created_at", { precision: 3, mode: "string" }),
  updatedAt: updatedAt(),
  avatarUrl: text("avatar_url"),
  bannerUrl: text("banner_url"),
  bot: boolean("bot").default(false).notNull(),
  flags: bigint("flags", { mode: "number" }),
  system: boolean("system").default(false).notNull(),
});

export const memberGuild = pgTable(
  "member_guilds",
  {
    id: serial("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, { onDelete: "cascade", onUpdate: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, { onDelete: "restrict", onUpdate: "cascade" }),
    status: boolean("status").default(true).notNull(),
    nickname: text("nickname"),
    displayName: text("display_name"),
    warnings: integer("warnings").default(0).notNull(),
    joinedAt: timestamp("joined_at", { precision: 3, mode: "string" }),
    premiumSince: timestamp("premium_since", { precision: 3, mode: "string" }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_member_guilds_member_guild").on(table.memberId, table.guildId),
  ],
);

export const memberRole = pgTable(
  "member_roles",
  {
    id: serial("id").primaryKey(),
    roleId: text("role_id").notNull(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, { onDelete: "restrict", onUpdate: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text("name"),
    color: integer("color"),
    hexColor: text("hex_color"),
    position: integer("position"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_member_roles_member_guild").on(table.memberId, table.guildId),
    uniqueIndex("uq_member_roles_member_role").on(table.memberId, table.roleId),
  ],
);

export const memberMessages = pgTable(
  "member_messages",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, { onDelete: "cascade", onUpdate: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, { onDelete: "restrict", onUpdate: "cascade" }),
    messageId: text("message_id").notNull(),
    channelId: text("channel_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_member_messages_message").on(table.messageId),
    index("idx_member_messages_member_guild").on(table.memberId, table.guildId),
  ],
);

export const ticket = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    openerId: text("opener_id").notNull(),
    category: text("category").default("support").notNull(),
    status: text("status").default("open").notNull(),
    // Reward intent set when staff approves; consumed on opener-redeem (or
    // immediately on grantQuota when the opener is already linked). Once
    // redeemedAt is set the ticket cannot be re-rewarded.
    pendingRewardQuota: integer("pending_reward_quota"),
    pendingRewardReason: text("pending_reward_reason"),
    pendingRewardGrantedBy: text("pending_reward_granted_by"),
    redeemedAt: timestamp("redeemed_at", { precision: 3, mode: "string" }),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { precision: 3, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_tickets_channel").on(table.channelId),
    index("idx_tickets_opener_status").on(table.openerId, table.status),
  ],
);

export const ticketMessage = pgTable(
  "ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade", onUpdate: "cascade" }),
    authorId: text("author_id").notNull(),
    authorTag: text("author_tag").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_ticket_messages_ticket").on(table.ticketId)],
);

export const bugReport = pgTable(
  "bug_reports",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    forumThreadId: text("forum_thread_id").notNull(),
    reporterId: text("reporter_id").notNull(),
    status: text("status").default("open").notNull(),
    rewardedQuota: integer("rewarded_quota").default(0).notNull(),
    resolvedBy: text("resolved_by"),
    // Same pending-reward intent as tickets: staff approve sets these, the
    // recipient redeems (or instant grant when already linked) clears them +
    // stamps resolvedAt. Re-rewards are blocked once resolvedAt is set. The
    // recipient may differ from the reporter (some other thread participant
    // may have actually identified the bug), so pendingRewardTargetId is
    // recorded explicitly.
    pendingRewardQuota: integer("pending_reward_quota"),
    pendingRewardReason: text("pending_reward_reason"),
    pendingRewardGrantedBy: text("pending_reward_granted_by"),
    pendingRewardTargetId: text("pending_reward_target_id"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { precision: 3, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_bug_reports_forum_thread").on(table.forumThreadId),
  ],
);

export const grantLog = pgTable(
  "grant_logs",
  {
    id: serial("id").primaryKey(),
    targetDiscordId: text("target_discord_id").notNull(),
    newApiUserId: integer("new_api_user_id"),
    quota: integer("quota").notNull(),
    reason: text("reason").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    grantedByDiscordId: text("granted_by_discord_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_grant_logs_target").on(table.targetDiscordId),
    index("idx_grant_logs_source").on(table.sourceType, table.sourceId),
  ],
);
