// Single source for every Discord component customId in the bot. Centralised so
// renames touch one place and decorator handlers + builders never drift.

// --- Static button ids (fixed string, no payload) ---
export const ButtonId = {
  // Verify channel
  ClaimConnect: "claim_connect",
  // Ticket-panel entry buttons
  TicketOpenSupport: "ticket_open_support",
  TicketOpenBug: "ticket_open_bug",
  // Per-ticket control row
  TicketReward: "ticket_reward",
  TicketClose: "ticket_close",
  // Bug-report control row
  BugReward: "bug_reward",
  BugReject: "bug_reject",
  BugLock: "bug_lock",
  BugClose: "bug_close",
} as const;
export type ButtonId = (typeof ButtonId)[keyof typeof ButtonId];

// --- Parametric button id prefixes ("<prefix>:<id>") ---
// Use ButtonIdBuilder.<x>(arg) to format and ButtonIdPattern.<x> in the
// @ButtonComponent decorator so the regex stays in sync with the builder.
export const ButtonIdPrefix = {
  TicketRedeem: "ticket_redeem",
  BugRedeem: "bug_redeem",
} as const;

export const ButtonIdBuilder = {
  ticketRedeem: (ticketId: number) =>
    `${ButtonIdPrefix.TicketRedeem}:${ticketId}`,
  bugRedeem: (bugId: number) => `${ButtonIdPrefix.BugRedeem}:${bugId}`,
} as const;

export const ButtonIdPattern = {
  TicketRedeem: new RegExp(`^${ButtonIdPrefix.TicketRedeem}:\\d+$`),
  BugRedeem: new RegExp(`^${ButtonIdPrefix.BugRedeem}:\\d+$`),
} as const;

// --- Modal ids ---
// Reward modal carries 3 payload fields. Format reads like
// reward_modal:<source>:<sourceId>:<targetDiscordId>.
export const ModalIdPrefix = {
  Reward: "reward_modal",
} as const;

export const ModalIdBuilder = {
  reward: (
    source: "ticket" | "bug",
    sourceId: string,
    targetDiscordId: string,
  ) => `${ModalIdPrefix.Reward}:${source}:${sourceId}:${targetDiscordId}`,
} as const;

export const ModalIdPattern = {
  RewardTicket: new RegExp(`^${ModalIdPrefix.Reward}:ticket:`),
  RewardBug: new RegExp(`^${ModalIdPrefix.Reward}:bug:`),
} as const;

// --- Field ids inside the Reward modal ---
export const RewardModalField = {
  Tier: "reward_tier",
  Reason: "reward_reason",
  Recipient: "reward_recipient",
} as const;
