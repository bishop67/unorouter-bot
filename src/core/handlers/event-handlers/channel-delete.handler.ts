import { db } from "@/lib/db";
import { ticket } from "@/lib/db-schema";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";
import type { DMChannel, GuildChannel } from "discord.js";

// When a ticket channel is deleted manually by an admin (instead of via the
// in-channel Close button), mark the matching ticket row as closed so the
// one-open-per-user guard doesn't see it as still active.
export async function handleChannelDelete(
  channel: DMChannel | GuildChannel,
): Promise<void> {
  if (channel.isDMBased()) return;

  try {
    const result = await db
      .update(ticket)
      .set({ status: "closed", closedAt: new Date().toISOString() })
      .where(and(eq(ticket.channelId, channel.id), eq(ticket.status, "open")))
      .returning({ id: ticket.id });
    if (result.length > 0) {
      logger.info("Ticket closed via channel delete", {
        ticketId: result[0]!.id,
        channelId: channel.id,
      });
    }
  } catch (err) {
    logger.error("channelDelete handler failed", { error: String(err) });
  }
}
