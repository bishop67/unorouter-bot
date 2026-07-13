import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
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
// - Discord ids (guild/member/role/channel/message) are the natural text keys.
// - Closed-set columns are Postgres native enums; their display labels live in
//   app code (GRANT_SOURCE_LABEL / VOTE_SITE_LABEL / DM_SOURCE_LABEL).

const createdAt = () =>
  timestamp("created_at", { precision: 3, mode: "string" })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();

const updatedAt = () =>
  timestamp("updated_at", { precision: 3, mode: "string" })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull();

// --- Enums (mirror the constants in src/types/index.ts) ---
export const rewardSourceEnum = pgEnum("reward_source", [
  "command",
  "ticket",
  "bug",
  "boost",
  "connect",
  "vote",
  "invite",
  "level",
]);
export const claimStatusEnum = pgEnum("claim_status", [
  "pending",
  "paid",
  "void",
]);
export const voteSiteEnum = pgEnum("vote_site", [
  "topgg",
  "discords",
  "discadia",
  "discordservers",
]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "closed"]);
export const ticketCategoryEnum = pgEnum("ticket_category", ["support", "bug"]);
export const bugStatusEnum = pgEnum("bug_status", [
  "open",
  "approved",
  "rejected",
]);

// --- Identity core ---

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

// One row per guild role. Extracted from member_roles so role attributes
// (name/color/position) are stored once, not duplicated per holder. hexColor is
// derived from color at read, not stored.
export const role = pgTable(
  "roles",
  {
    roleId: text("role_id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name"),
    color: integer("color"),
    position: integer("position"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("idx_roles_guild").on(table.guildId)],
);

// One row per referenced Discord channel. FK target for message/ticket rows so
// channel_id is a real reference, not a bare id.
export const channel = pgTable(
  "channels",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("idx_channels_guild").on(table.guildId)],
);

export const memberGuild = pgTable(
  "member_guilds",
  {
    id: serial("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    status: boolean("status").default(true).notNull(),
    nickname: text("nickname"),
    warnings: integer("warnings").default(0).notNull(),
    joinedAt: timestamp("joined_at", { precision: 3, mode: "string" }),
    premiumSince: timestamp("premium_since", { precision: 3, mode: "string" }),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_member_guilds_member_guild").on(
      table.memberId,
      table.guildId,
    ),
  ],
);

// Pure member<->role association. Role attributes live in `roles`.
export const memberRole = pgTable(
  "member_roles",
  {
    id: serial("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => role.roleId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    messageId: text("message_id").notNull(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.channelId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_member_messages_message").on(table.messageId),
    index("idx_member_messages_member_guild").on(table.memberId, table.guildId),
  ],
);

// --- Domain entities ---

export const ticket = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.channelId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    openerId: text("opener_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    category: ticketCategoryEnum("category").default("support").notNull(),
    status: ticketStatusEnum("status").default("open").notNull(),
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
      .references(() => ticket.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    authorId: text("author_id").references(() => member.memberId, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_ticket_messages_ticket").on(table.ticketId)],
);

export const bugReport = pgTable(
  "bug_reports",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    forumThreadId: text("forum_thread_id").notNull(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    status: bugStatusEnum("status").default("open").notNull(),
    rewardedQuota: integer("rewarded_quota").default(0).notNull(),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { precision: 3, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_bug_reports_forum_thread").on(table.forumThreadId),
  ],
);

// One row per boost slot a member holds. nextPayoutAt advances 30 days each time
// the monthly cron credits the member; active flips false on cancel.
export const boostSlot = pgTable(
  "boost_slots",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourceMessageId: text("source_message_id"),
    startedAt: createdAt(),
    nextPayoutAt: timestamp("next_payout_at", {
      precision: 3,
      mode: "string",
    }).notNull(),
    active: boolean("active").default(true).notNull(),
    cancelledAt: timestamp("cancelled_at", { precision: 3, mode: "string" }),
  },
  (table) => [
    index("idx_boost_slots_member_guild").on(table.memberId, table.guildId),
    index("idx_boost_slots_due").on(table.active, table.nextPayoutAt),
  ],
);

// One row per attributed join. Unique (guild, invitee) blocks rejoin farming.
// inviter_id is FK-less: the inviter may have left before the bot existed and is
// never upserted into members.
export const inviteJoin = pgTable(
  "invite_joins",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    inviterId: text("inviter_id").notNull(),
    inviteeId: text("invitee_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inviteCode: text("invite_code").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_invite_joins_guild_invitee").on(
      table.guildId,
      table.inviteeId,
    ),
    index("idx_invite_joins_inviter_guild").on(table.inviterId, table.guildId),
  ],
);

// One-time baseline of Discord's per-invite uses counters at tracking launch.
// inviter_id FK-less (same reason as invite_joins).
export const inviteSeed = pgTable(
  "invite_seeds",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    inviterId: text("inviter_id").notNull(),
    uses: integer("uses").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_invite_seeds_guild_inviter").on(
      table.guildId,
      table.inviterId,
    ),
  ],
);

// --- Reward domain ---

// Append-only audit: one row per successful new-api credit. granted_by is NULL
// for automated ("system") grants, else the acting member. The dedupe index
// serves both connect (target+source) and vote (target+source+source_id+time).
export const rewardGrant = pgTable(
  "reward_grants",
  {
    id: serial("id").primaryKey(),
    targetMemberId: text("target_member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    guildId: text("guild_id").references(() => guild.guildId, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    newApiUserId: integer("new_api_user_id"),
    quota: integer("quota").notNull(),
    reason: text("reason").notNull(),
    sourceType: rewardSourceEnum("source_type").notNull(),
    sourceId: text("source_id"),
    grantedByMemberId: text("granted_by_member_id").references(
      () => member.memberId,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_reward_grants_target").on(table.targetMemberId),
    index("idx_reward_grants_dedupe").on(
      table.targetMemberId,
      table.sourceType,
      table.sourceId,
      table.createdAt,
    ),
  ],
);

// At-most-once reward obligation per (source, entity). Folds level_rewards, the
// invite ledger, and the ticket/bug pending-redeem intent into one table. A
// claim is created pending, transitions to paid when the grant lands (grant_id
// links the audit row). rewarded_at is the once-lock.
export const rewardClaim = pgTable(
  "reward_claims",
  {
    id: serial("id").primaryKey(),
    sourceType: rewardSourceEnum("source_type").notNull(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.guildId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    targetMemberId: text("target_member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    refId: text("ref_id"),
    status: claimStatusEnum("status").default("pending").notNull(),
    pendingQuota: integer("pending_quota"),
    pendingReason: text("pending_reason"),
    grantedByMemberId: text("granted_by_member_id").references(
      () => member.memberId,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    earnedUnits: integer("earned_units"),
    rewardedQuota: integer("rewarded_quota").default(0).notNull(),
    rewardedAt: timestamp("rewarded_at", { precision: 3, mode: "string" }),
    grantId: integer("grant_id").references(() => rewardGrant.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_reward_claims_source_guild_target_ref").on(
      table.sourceType,
      table.guildId,
      table.targetMemberId,
      table.refId,
    ),
    index("idx_reward_claims_status").on(table.status, table.sourceType),
  ],
);

// --- Operational state ---

// Reward-DM opt-outs. Presence of a (member, source) row = muted. Only recurring
// sources (vote/invite/level/boost) are toggled by /notifications.
export const dmOptout = pgTable(
  "dm_optouts",
  {
    id: serial("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    source: rewardSourceEnum("source").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_dm_optouts_member_source").on(table.memberId, table.source),
  ],
);

// Persisted "member currently holds this vote role" transition guard.
export const voteRoleHold = pgTable(
  "vote_role_holds",
  {
    id: serial("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.memberId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    site: voteSiteEnum("site").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_vote_role_holds_member_site").on(table.memberId, table.site),
  ],
);
