import { utcMs } from "@/core/services/moderation/modlog.service";
import { WatchlistService } from "@/core/services/moderation/watchlist.service";
import {
  HELPER_COMMAND_PERMISSION,
  isHelper,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

const NOT_ALLOWED = "You are not allowed to use this command.";
const since = (createdAt: string) => `<t:${Math.floor(utcMs(createdAt) / 1000)}:R>`;

async function start(
  interaction: CommandInteraction,
  allowed: (member: GuildMember) => boolean,
): Promise<boolean> {
  if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
    return false;
  const member = interaction.member as GuildMember | null;
  if (!interaction.guild || !member || !allowed(member)) {
    await safeEditReply(interaction, NOT_ALLOWED);
    return false;
  }
  return true;
}

@Discord()
@SlashGroup({
  name: "watchlist",
  description: "Members staff should keep an eye on",
  dmPermission: false,
  defaultMemberPermissions: HELPER_COMMAND_PERMISSION,
})
@SlashGroup("watchlist")
export class WatchlistCommands {
  @Slash({ name: "add", description: "Put a member on the watchlist" })
  async add(
    @SlashOption({
      name: "user",
      description: "Member to watch",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!(await start(interaction, isHelper))) return;

    if (user.bot) {
      await safeEditReply(interaction, "Bots cannot be put on the watchlist.");
      return;
    }
    const target = await interaction
      .guild!.members.fetch(user.id)
      .catch(() => null);
    if (target && isHelper(target)) {
      await safeEditReply(interaction, "Staff cannot be put on the watchlist.");
      return;
    }

    const { added, entry } = await WatchlistService.add(
      interaction.guild!.id,
      user.id,
      user.username,
      interaction.user.id,
    );
    await safeEditReply(interaction, {
      content: added
        ? `Added <@${user.id}> to the watchlist.`
        : `<@${user.id}> is already on the watchlist, added by <@${entry?.addedBy}> ${entry ? since(entry.createdAt) : ""}.`,
      allowedMentions: { parse: [] },
    });
  }

  @Slash({ name: "view", description: "Show everyone on the watchlist" })
  async view(interaction: CommandInteraction) {
    if (!(await start(interaction, isHelper))) return;

    const rows = await WatchlistService.list(interaction.guild!.id);
    if (!rows.length) {
      await safeEditReply(interaction, "The watchlist is empty.");
      return;
    }

    let content = `**Watchlist** (${rows.length})`;
    let shown = 0;
    for (const row of rows) {
      const line = `\n<@${row.memberId}> (${row.username}), added by <@${row.addedBy}> ${since(row.createdAt)}`;
      if (content.length + line.length > 1950) break;
      content += line;
      shown++;
    }
    if (shown < rows.length) content += `\n…and ${rows.length - shown} more`;

    await safeEditReply(interaction, {
      content,
      allowedMentions: { parse: [] },
    });
  }
}

@Discord()
export class WatchlistRemoveCommand {
  @Slash({
    name: "watchlist-remove",
    description: "Take a member off the watchlist (admins)",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async watchlistRemove(
    @SlashOption({
      name: "user",
      description: "Member to take off the watchlist",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (
      !(await start(interaction, (member) =>
        member.permissions.has(PermissionFlagsBits.Administrator),
      ))
    )
      return;

    const removed = await WatchlistService.remove(
      interaction.guild!.id,
      user.id,
    );
    await safeEditReply(interaction, {
      content: removed
        ? `Removed <@${user.id}> from the watchlist (added by <@${removed.addedBy}>).`
        : `<@${user.id}> is not on the watchlist.`,
      allowedMentions: { parse: [] },
    });
  }
}
