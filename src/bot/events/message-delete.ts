import { RecentMessagesService } from "@/core/services/messages/recent-messages.service";
import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageDelete {
  @On({ event: "messageDelete" })
  async messageDelete([message]: ArgsOf<"messageDelete">): Promise<void> {
    await RecentMessagesService.forget([message.id]);
  }

  @On({ event: "messageDeleteBulk" })
  async messageDeleteBulk([
    messages,
  ]: ArgsOf<"messageDeleteBulk">): Promise<void> {
    await RecentMessagesService.forget([...messages.keys()]);
  }
}
