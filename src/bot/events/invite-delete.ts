import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { InviteService } from "@/core/services/invites/invite.service";

@Discord()
export class InviteDelete {
  @On({ event: "inviteDelete" })
  inviteDelete([invite]: ArgsOf<"inviteDelete">): void {
    InviteService.trackDelete(invite);
  }
}
