import { relations } from "drizzle-orm/relations";
import {
  boostSlot,
  channel,
  dmOptout,
  guild,
  inviteJoin,
  inviteSeed,
  member,
  memberGuild,
  memberMessages,
  memberRole,
  rewardClaim,
  rewardGrant,
  role,
  ticket,
  ticketMessage,
  voteRoleHold,
} from "./schema";

export const guildRelations = relations(guild, ({ many }) => ({
  memberGuilds: many(memberGuild),
  memberRoles: many(memberRole),
  memberMessages: many(memberMessages),
  roles: many(role),
  channels: many(channel),
}));

export const memberRelations = relations(member, ({ many }) => ({
  memberGuilds: many(memberGuild),
  memberRoles: many(memberRole),
  memberMessages: many(memberMessages),
  rewardGrants: many(rewardGrant),
  rewardClaims: many(rewardClaim),
  boostSlots: many(boostSlot),
  voteRoleHolds: many(voteRoleHold),
  dmOptouts: many(dmOptout),
}));

export const roleRelations = relations(role, ({ one, many }) => ({
  guild: one(guild, {
    fields: [role.guildId],
    references: [guild.guildId],
  }),
  memberRoles: many(memberRole),
}));

export const channelRelations = relations(channel, ({ one, many }) => ({
  guild: one(guild, {
    fields: [channel.guildId],
    references: [guild.guildId],
  }),
  memberMessages: many(memberMessages),
  tickets: many(ticket),
}));

export const memberGuildRelations = relations(memberGuild, ({ one }) => ({
  guild: one(guild, {
    fields: [memberGuild.guildId],
    references: [guild.guildId],
  }),
  member: one(member, {
    fields: [memberGuild.memberId],
    references: [member.memberId],
  }),
}));

export const memberRoleRelations = relations(memberRole, ({ one }) => ({
  guild: one(guild, {
    fields: [memberRole.guildId],
    references: [guild.guildId],
  }),
  member: one(member, {
    fields: [memberRole.memberId],
    references: [member.memberId],
  }),
  role: one(role, {
    fields: [memberRole.roleId],
    references: [role.roleId],
  }),
}));

export const memberMessagesRelations = relations(memberMessages, ({ one }) => ({
  guild: one(guild, {
    fields: [memberMessages.guildId],
    references: [guild.guildId],
  }),
  member: one(member, {
    fields: [memberMessages.memberId],
    references: [member.memberId],
  }),
  channel: one(channel, {
    fields: [memberMessages.channelId],
    references: [channel.channelId],
  }),
}));

export const ticketRelations = relations(ticket, ({ one, many }) => ({
  guild: one(guild, {
    fields: [ticket.guildId],
    references: [guild.guildId],
  }),
  opener: one(member, {
    fields: [ticket.openerId],
    references: [member.memberId],
  }),
  channel: one(channel, {
    fields: [ticket.channelId],
    references: [channel.channelId],
  }),
  messages: many(ticketMessage),
}));

export const ticketMessageRelations = relations(ticketMessage, ({ one }) => ({
  ticket: one(ticket, {
    fields: [ticketMessage.ticketId],
    references: [ticket.id],
  }),
  author: one(member, {
    fields: [ticketMessage.authorId],
    references: [member.memberId],
  }),
}));

export const rewardGrantRelations = relations(rewardGrant, ({ one }) => ({
  target: one(member, {
    fields: [rewardGrant.targetMemberId],
    references: [member.memberId],
  }),
  guild: one(guild, {
    fields: [rewardGrant.guildId],
    references: [guild.guildId],
  }),
}));

export const rewardClaimRelations = relations(rewardClaim, ({ one }) => ({
  target: one(member, {
    fields: [rewardClaim.targetMemberId],
    references: [member.memberId],
  }),
  guild: one(guild, {
    fields: [rewardClaim.guildId],
    references: [guild.guildId],
  }),
  grant: one(rewardGrant, {
    fields: [rewardClaim.grantId],
    references: [rewardGrant.id],
  }),
}));

export const boostSlotRelations = relations(boostSlot, ({ one }) => ({
  guild: one(guild, {
    fields: [boostSlot.guildId],
    references: [guild.guildId],
  }),
  member: one(member, {
    fields: [boostSlot.memberId],
    references: [member.memberId],
  }),
}));

export const voteRoleHoldRelations = relations(voteRoleHold, ({ one }) => ({
  member: one(member, {
    fields: [voteRoleHold.memberId],
    references: [member.memberId],
  }),
}));

export const dmOptoutRelations = relations(dmOptout, ({ one }) => ({
  member: one(member, {
    fields: [dmOptout.memberId],
    references: [member.memberId],
  }),
}));

export const inviteJoinRelations = relations(inviteJoin, ({ one }) => ({
  guild: one(guild, {
    fields: [inviteJoin.guildId],
    references: [guild.guildId],
  }),
  invitee: one(member, {
    fields: [inviteJoin.inviteeId],
    references: [member.memberId],
  }),
}));

export const inviteSeedRelations = relations(inviteSeed, ({ one }) => ({
  guild: one(guild, {
    fields: [inviteSeed.guildId],
    references: [guild.guildId],
  }),
}));
