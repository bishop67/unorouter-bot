import { MessagesService } from "@/core/services/messages/messages.service";
import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageUpdate {
  @On({ event: "messageUpdate" })
  async messageUpdate([
    oldMessage,
    newMessage,
  ]: ArgsOf<"messageUpdate">): Promise<void> {
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;

    if (!message || !message.guild || message.author?.bot) return;

    if (oldMessage.content === message.content) return;

    await MessagesService.checkWarnings(message);
  }
}
