export const DUPLICATE_WARNING_THRESHOLD = 3; // Start warning at 3rd duplicate
export const DUPLICATE_JAIL_THRESHOLD = 5; // Jail at 5th duplicate
export const CHANNEL_WARNING_THRESHOLD = 8; // Start warning at 8th channel
export const CHANNEL_JAIL_THRESHOLD = 10; // Jail at 10th channel
export const CHANNEL_SPAM_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Ticket open/close churn limiter. Actions beyond LIMIT in the rolling window
// are refused with a retry hint; at JAIL_LIMIT the user is jailed (chat
// anti-spam parity).
export const TICKET_ACTION_LIMIT = 3;
export const TICKET_ACTION_JAIL_LIMIT = 6;
export const TICKET_ACTION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
