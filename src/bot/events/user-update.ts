import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { handleUserUpdate } from "@/core/handlers/event-handlers/user-update.handler";

@Discord()
export class UserUpdate {
  @On()
  async userUpdate([oldUser, newUser]: ArgsOf<"userUpdate">) {
    await handleUserUpdate(oldUser, newUser);
  }
}
