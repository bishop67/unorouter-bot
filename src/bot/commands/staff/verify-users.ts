import { VerifyAllUsersService } from "@/core/services/members/verify-users.service";
import { isStaff } from "@/core/utils/command.utils";
import { ChannelType, type GuildMember, type TextChannel } from "discord.js";
import type { SimpleCommandMessage } from "discordx";
import { Discord, SimpleCommand } from "discordx";

@Discord()
export class VerifyUsers {
  @SimpleCommand({
    aliases: ["verify", "verify-user", "verify-users", "verify-all"],
    prefix: "!",
  })
  async verifyUsers(command: SimpleCommandMessage) {
    const message = command.message;
    if (!message.guild || !isStaff(message.member as GuildMember | null))
      return;
    if (message.channel.type !== ChannelType.GuildText) return;

    await VerifyAllUsersService.verifyAll(
      message.guild,
      message.channel as TextChannel,
    );
  }
}
