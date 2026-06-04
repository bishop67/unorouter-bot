import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { handleChannelDelete } from "@/core/handlers/event-handlers/channel-delete.handler";

@Discord()
export class ChannelDelete {
  @On({ event: "channelDelete" })
  async channelDelete([channel]: ArgsOf<"channelDelete">): Promise<void> {
    await handleChannelDelete(channel);
  }
}
