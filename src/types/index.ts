import type { InferSelectModel } from "drizzle-orm";
import type { memberRole } from "@/lib/db-schema";
import type {
  Collection,
  Guild,
  GuildMember,
  PartialGuildMember,
  Role,
  User,
} from "discord.js";

type MemberRole = InferSelectModel<typeof memberRole>;

// AI chat
export interface AiChatResponse {
  text: string;
  gifUrl: string | null;
}

export interface MessageContext {
  context: string;
  images: string[];
}

export interface ReplyContext {
  replyContext: string;
  repliedImages: string[];
}

// Embeds
export interface UserJailedEmbedParams {
  memberId: string;
  displayName: string;
  username: string;
  reason?: string;
}

// Jail / message deletion
export interface DeleteUserMessagesParams {
  guild: Guild;
  user: User | null;
  memberId: string;
  jail: string | number | boolean;
  reason?: string;
}

// Roles service
export type UpdateDbRolesArgs = {
  oldRoles: Role[];
  newRoles: Role[];
  oldMember: GuildMember | PartialGuildMember;
  newMember: GuildMember | PartialGuildMember;
  guildRoles: Collection<string, Role>;
  memberDbRoles: MemberRole[];
};

// Spam detection
export interface UserSpamState {
  count: number;
  lastContent: string;
  lastAttachmentHashes: string[];
  recentChannels: Array<{ channelId: string; timestamp: number }>;
}

export interface SpamDetectionContext {
  accountAge: number;
  memberAge: number | null;
  channelName: string;
  username: string;
  displayName: string;
  hasCustomAvatar: boolean;
  hasBanner: boolean;
  userFlags: string[];
  isSystemAccount: boolean;
  roles: string[];
  messageLength: number;
  hasLinks: boolean;
  hasMentions: boolean;
  imageCount: number;
  messageContent: string;
}

export interface SpamDetectionResult {
  isSpam: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// Grant
export const GrantSource = {
  Command: "command",
  Ticket: "ticket",
  Bug: "bug",
  Boost: "boost",
  Connect: "connect",
  Vote: "vote",
} as const;
export type GrantSourceType = (typeof GrantSource)[keyof typeof GrantSource];

// Human-readable label for grants-log announce + dashboards.
export const GRANT_SOURCE_LABEL: Record<GrantSourceType, string> = {
  command: "manual",
  ticket: "support ticket",
  bug: "bug bounty",
  boost: "server boost",
  connect: "connect bonus",
  vote: "vote reward",
};

// Listing sites that send a SERVER vote webhook we can grant balance from. Used
// as grantLog.sourceId. Only Top.gg exposes one; Discords.com/DBL server votes
// give a Discord role via their own dashboard, no webhook.
export const VoteSite = {
  TopGg: "topgg",
} as const;
export type VoteSite = (typeof VoteSite)[keyof typeof VoteSite];

export const VOTE_SITE_LABEL: Record<VoteSite, string> = {
  topgg: "Top.gg",
};

export interface GrantResult {
  linked: boolean;
  userId?: number;
  quota: number;
}
