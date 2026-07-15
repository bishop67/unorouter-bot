import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { handleGuildMemberRemove } from "@/core/handlers/event-handlers/guild-member-remove.handler";

@Discord()
export class GuildMemberRemove {
  @On({ event: "guildMemberRemove" })
  async guildMemberRemove([
    member,
  ]: ArgsOf<"guildMemberRemove">): Promise<void> {
    await handleGuildMemberRemove(member);
  }
}
