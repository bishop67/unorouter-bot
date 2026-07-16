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
  stickerId: string | null;
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
  Invite: "invite",
  Level: "level",
  Transfer: "transfer",
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
  invite: "invite reward",
  level: "level reward",
  transfer: "balance transfer",
};

// Vote sources, used as grantLog.sourceId. Top.gg sends a real webhook; Discords.com
// and Discadia have none, so their dashboards assign a role on upvote which the bot
// treats as the signal (role-add -> grant -> strip role). DiscordServers.com routes
// votes through the VoteManager.xyz partner bot, which adds a role on each vote and
// removes it itself after a duration, so the bot must NOT strip that role.
export const VoteSite = {
  TopGg: "topgg",
  Discords: "discords",
  Discadia: "discadia",
  DiscordServers: "discordservers",
} as const;
export type VoteSite = (typeof VoteSite)[keyof typeof VoteSite];

export const VOTE_SITE_LABEL: Record<VoteSite, string> = {
  topgg: "Top.gg",
  discords: "Discords.com",
  discadia: "Discadia",
  discordservers: "DiscordServers.com",
};

export interface GrantResult {
  linked: boolean;
  userId?: number;
  quota: number;
}

export type TransferResult =
  | { ok: true; fromBalanceQuota: number }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "invalid_amount"
        | "self"
        | "sender_not_linked"
        | "receiver_not_linked"
        | "insufficient";
      fromBalanceQuota?: number;
    };

// Reward DMs a member can opt out of, per event. Recurring/noisy sources only;
// one-time grants (connect, bug, ticket, manual) always DM so they're not missed.
export const DM_TOGGLEABLE_SOURCES = [
  GrantSource.Vote,
  GrantSource.Invite,
  GrantSource.Level,
  GrantSource.Boost,
] as const satisfies ReadonlyArray<GrantSourceType>;
export type DmToggleableSource = (typeof DM_TOGGLEABLE_SOURCES)[number];

export function isDmToggleable(
  source: GrantSourceType,
): source is DmToggleableSource {
  return (DM_TOGGLEABLE_SOURCES as ReadonlyArray<GrantSourceType>).includes(
    source,
  );
}

// Label for the /notifications toggle buttons.
export const DM_SOURCE_LABEL: Record<DmToggleableSource, string> = {
  vote: "Vote rewards",
  invite: "Invite rewards",
  level: "Level-up rewards",
  boost: "Boost rewards",
};
