import { WatchlistService } from "@/core/services/moderation/watchlist.service";
import {
  fitLines,
  HELPER_COMMAND_PERMISSION,
  isHelper,
  safeEditReply,
  startStaffCommand,
} from "@/core/utils/command.utils";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

async function addMember(interaction: CommandInteraction, user: User) {
  const guild = interaction.guild!;
  if (user.bot) return "Bots cannot be put on the watchlist.";
  const target = await guild.members.fetch(user.id).catch(() => null);
  if (isHelper(target)) return "Staff cannot be put on the watchlist.";

  const { added, entry } = await WatchlistService.add(
    guild.id,
    user.id,
    interaction.user.id,
  );
  return added
    ? `Added <@${user.id}> to the watchlist.`
    : `<@${user.id}> is already on the watchlist, added by <@${entry?.addedBy}>.`;
}

async function removeMember(interaction: CommandInteraction, user: User) {
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.Administrator))
    return "Only admins can take someone off the watchlist.";

  const removed = await WatchlistService.remove(interaction.guild!.id, user.id);
  return removed
    ? `Removed <@${user.id}> from the watchlist.`
    : `<@${user.id}> is not on the watchlist.`;
}

@Discord()
export class WatchlistCommand {
  @Slash({
    name: "watchlist",
    description: "Show the watchlist, or add or remove a member",
    dmPermission: false,
    defaultMemberPermissions: HELPER_COMMAND_PERMISSION,
  })
  async watchlist(
    @SlashOption({
      name: "add",
      description: "Member to put on the watchlist",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    add: User | undefined,
    @SlashOption({
      name: "remove",
      description: "Member to take off the watchlist (admins)",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    remove: User | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await startStaffCommand(interaction, isHelper))) return;
    const guild = interaction.guild!;
    const reply = (content: string) =>
      safeEditReply(interaction, { content, allowedMentions: { parse: [] } });

    if (add && remove) return reply("Pick either add or remove, not both.");
    if (remove) return reply(await removeMember(interaction, remove));
    if (add) return reply(await addMember(interaction, add));

    const rows = await WatchlistService.list(guild.id);
    if (!rows.length) return reply("The watchlist is empty.");
    return reply(
      fitLines([
        `**Watchlist** (${rows.length})`,
        ...rows.map((row) => `<@${row.memberId}>, added by <@${row.addedBy}>`),
      ]),
    );
  }
}
