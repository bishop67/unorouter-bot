import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { handleThreadDelete } from "@/core/handlers/event-handlers/thread-delete.handler";

@Discord()
export class ThreadDelete {
  @On({ event: "threadDelete" })
  async threadDelete([thread]: ArgsOf<"threadDelete">): Promise<void> {
    await handleThreadDelete(thread);
  }
}
