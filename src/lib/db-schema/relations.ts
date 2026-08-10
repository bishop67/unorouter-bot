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
  giveawayEntry,
  giveawayRaffle,
  giveawayRaffleEntry,
  giveawayRaffleWinner,
  giveawayRound,
  giveawayWinner,
  role,
  serverTagWear,
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
  serverTagWears: many(serverTagWear),
  giveawayWins: many(giveawayWinner),
  giveawayEntries: many(giveawayEntry),
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

export const serverTagWearRelations = relations(serverTagWear, ({ one }) => ({
  guild: one(guild, {
    fields: [serverTagWear.guildId],
    references: [guild.guildId],
  }),
  member: one(member, {
    fields: [serverTagWear.memberId],
    references: [member.memberId],
  }),
}));

export const giveawayRoundRelations = relations(
  giveawayRound,
  ({ one, many }) => ({
    guild: one(guild, {
      fields: [giveawayRound.guildId],
      references: [guild.guildId],
    }),
    winners: many(giveawayWinner),
    entries: many(giveawayEntry),
  }),
);

export const giveawayEntryRelations = relations(giveawayEntry, ({ one }) => ({
  round: one(giveawayRound, {
    fields: [giveawayEntry.roundId],
    references: [giveawayRound.id],
  }),
  member: one(member, {
    fields: [giveawayEntry.memberId],
    references: [member.memberId],
  }),
}));

export const giveawayWinnerRelations = relations(giveawayWinner, ({ one }) => ({
  round: one(giveawayRound, {
    fields: [giveawayWinner.roundId],
    references: [giveawayRound.id],
  }),
  member: one(member, {
    fields: [giveawayWinner.memberId],
    references: [member.memberId],
  }),
}));

export const giveawayRaffleRelations = relations(
  giveawayRaffle,
  ({ one, many }) => ({
    guild: one(guild, {
      fields: [giveawayRaffle.guildId],
      references: [guild.guildId],
    }),
    entries: many(giveawayRaffleEntry),
    winners: many(giveawayRaffleWinner),
  }),
);

export const giveawayRaffleEntryRelations = relations(
  giveawayRaffleEntry,
  ({ one }) => ({
    raffle: one(giveawayRaffle, {
      fields: [giveawayRaffleEntry.raffleId],
      references: [giveawayRaffle.id],
    }),
    member: one(member, {
      fields: [giveawayRaffleEntry.memberId],
      references: [member.memberId],
    }),
  }),
);

export const giveawayRaffleWinnerRelations = relations(
  giveawayRaffleWinner,
  ({ one }) => ({
    raffle: one(giveawayRaffle, {
      fields: [giveawayRaffleWinner.raffleId],
      references: [giveawayRaffle.id],
    }),
    member: one(member, {
      fields: [giveawayRaffleWinner.memberId],
      references: [member.memberId],
    }),
  }),
);

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
