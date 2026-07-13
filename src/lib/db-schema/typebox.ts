import { Type as t } from "@sinclair/typebox/type";
import { createSelectSchema } from "drizzle-typebox";
import {
  bugReport,
  channel,
  guild,
  member,
  memberGuild,
  memberMessages,
  memberRole,
  rewardClaim,
  rewardGrant,
  role,
  ticket,
  ticketMessage,
} from "./schema";

// Guild schemas
export const guildSelectSchema = createSelectSchema(guild);
export type Guild = typeof guildSelectSchema.static;
export const guildInsertSchema = t.Omit(guildSelectSchema, ["lookback"]);

// Member schemas
export const memberSelectSchema = createSelectSchema(member, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  username: t.String({ minLength: 1, maxLength: 32 }),
});
export type Member = typeof memberSelectSchema.static;
export const memberInsertSchema = t.Omit(memberSelectSchema, ["updatedAt"]);

// MemberGuild schemas
export const memberGuildSelectSchema = createSelectSchema(memberGuild, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberGuild = typeof memberGuildSelectSchema.static;

// Role schemas (guild role entity; attributes extracted from member_roles)
export const roleSelectSchema = createSelectSchema(role, {
  roleId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type Role = typeof roleSelectSchema.static;

// Channel schemas
export const channelSelectSchema = createSelectSchema(channel, {
  channelId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type Channel = typeof channelSelectSchema.static;

// MemberRole schemas (pure association)
export const memberRoleSelectSchema = createSelectSchema(memberRole, {
  roleId: t.String({ minLength: 17, maxLength: 20 }),
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberRole = typeof memberRoleSelectSchema.static;

// MemberMessages schemas
export const memberMessagesSelectSchema = createSelectSchema(memberMessages, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  messageId: t.String({ minLength: 17, maxLength: 20 }),
  channelId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberMessages = typeof memberMessagesSelectSchema.static;

// Ticket schemas
export const ticketSelectSchema = createSelectSchema(ticket);
export type Ticket = typeof ticketSelectSchema.static;

export const ticketMessageSelectSchema = createSelectSchema(ticketMessage);
export type TicketMessage = typeof ticketMessageSelectSchema.static;

// BugReport schemas
export const bugReportSelectSchema = createSelectSchema(bugReport);
export type BugReport = typeof bugReportSelectSchema.static;

// RewardGrant schemas (append-only reward audit)
export const rewardGrantSelectSchema = createSelectSchema(rewardGrant);
export type RewardGrant = typeof rewardGrantSelectSchema.static;

// RewardClaim schemas (at-most-once reward obligation)
export const rewardClaimSelectSchema = createSelectSchema(rewardClaim);
export type RewardClaim = typeof rewardClaimSelectSchema.static;
