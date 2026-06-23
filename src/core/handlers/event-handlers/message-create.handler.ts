import { BoostService } from "@/core/services/boost/boost.service";
import { MessagesService } from "@/core/services/messages/messages.service";
import { DuplicateSpamService } from "@/core/services/spam/duplicate-spam.service";
import { SpamDetectionService } from "@/core/services/spam/spam-detection.service";
import { TicketService } from "@/core/services/tickets/ticket.service";
import { Message } from "discord.js";

export async function handleMessageCreate(message: Message): Promise<void> {
  // Guild-only: this @On handler bypasses main.ts's guard, so skip DMs entirely.
  if (!message.guild) return;

  // Discord posts a system PREMIUM_GUILD_SUBSCRIPTION message in the configured
  // system channel for each boost transaction (including multi-boost from the
  // same user). Route those to the boost service before anything else.
  if (BoostService.isBoostSystemMessage(message)) {
    await BoostService.handleBoostMessage(message);
    return;
  }

  const isSpam =
    await SpamDetectionService.detectSpamFirstMessageWithAi(message);
  if (isSpam) return;

  await DuplicateSpamService.checkDuplicateSpam(message);

  await MessagesService.checkWarnings(message);

  await MessagesService.addMessageDb(message);

  await MessagesService.levelUpMessage(message);

  await TicketService.logTicketMessage(message);
}
