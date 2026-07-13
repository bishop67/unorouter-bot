import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { InviteService } from "@/core/services/invites/invite.service";

@Discord()
export class InviteCreate {
  @On({ event: "inviteCreate" })
  inviteCreate([invite]: ArgsOf<"inviteCreate">): void {
    InviteService.trackCreate(invite);
  }
}
