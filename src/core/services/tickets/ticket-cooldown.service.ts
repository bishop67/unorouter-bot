import {
  TICKET_ACTION_JAIL_LIMIT,
  TICKET_ACTION_LIMIT,
  TICKET_ACTION_WINDOW_MS,
} from "@/shared/config/spam";

export type TicketCooldownResult =
  | { action: "ok" }
  | { action: "blocked"; retryAfterMs: number; count: number }
  | { action: "jail"; count: number };

/**
 * In-memory sliding-window limiter for ticket open/close churn, mirroring the
 * chat anti-spam pattern. A user spamming open -> close -> open burns through
 * channel creates + transcript writes. Past LIMIT actions in the window are
 * refused; past JAIL_LIMIT the caller should jail the user.
 */
export class TicketCooldownService {
  private static actions = new Map<string, number[]>();

  static check(userId: string): TicketCooldownResult {
    const now = Date.now();
    const recent = (this.actions.get(userId) ?? []).filter(
      (t) => now - t < TICKET_ACTION_WINDOW_MS,
    );

    recent.push(now);
    this.actions.set(userId, recent);
    const count = recent.length;

    if (count >= TICKET_ACTION_JAIL_LIMIT) {
      return { action: "jail", count };
    }

    if (count > TICKET_ACTION_LIMIT) {
      const oldest = recent[0]!;
      return {
        action: "blocked",
        retryAfterMs: TICKET_ACTION_WINDOW_MS - (now - oldest),
        count,
      };
    }

    return { action: "ok" };
  }

  static reset(userId: string): void {
    this.actions.delete(userId);
  }
}
