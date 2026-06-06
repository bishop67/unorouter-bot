import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { handleThreadCreate } from "@/core/handlers/event-handlers/thread-create.handler";

@Discord()
export class ThreadCreate {
  @On({ event: "threadCreate" })
  async threadCreate([
    thread,
    newlyCreated,
  ]: ArgsOf<"threadCreate">): Promise<void> {
    if (!newlyCreated) return;
    await handleThreadCreate(thread);
  }
}
