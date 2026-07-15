import { MemberDataService } from "@/core/services/members/member-data.service";
import type { GuildMember, PartialGuildMember } from "discord.js";

export async function handleGuildMemberRemove(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;
  void MemberDataService.updateMemberCount(member.guild);
}
