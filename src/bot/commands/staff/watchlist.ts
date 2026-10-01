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
import { Discord, Slash, SlashOption } from "discordx";

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
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    const member = interaction.member as GuildMember | null;
    if (!interaction.guild || !isHelper(member)) {
      await safeEditReply(interaction, "You are not allowed to use this command.");
      return;
    }
    const guildId = interaction.guild.id;
    const reply = (content: string) =>
      safeEditReply(interaction, { content, allowedMentions: { parse: [] } });

    if (add && remove) {
      await reply("Pick either add or remove, not both.");
      return;
    }

    if (remove) {
      if (!member!.permissions.has(PermissionFlagsBits.Administrator)) {
        await reply("Only admins can take someone off the watchlist.");
        return;
      }
      const removed = await WatchlistService.remove(guildId, remove.id);
      await reply(
        removed
          ? `Removed <@${remove.id}> from the watchlist.`
          : `<@${remove.id}> is not on the watchlist.`,
      );
      return;
    }

    if (add) {
      if (add.bot) {
        await reply("Bots cannot be put on the watchlist.");
        return;
      }
      const target = await interaction.guild.members
        .fetch(add.id)
        .catch(() => null);
      if (target && isHelper(target)) {
        await reply("Staff cannot be put on the watchlist.");
        return;
      }
      const { added, entry } = await WatchlistService.add(
        guildId,
        add.id,
        interaction.user.id,
      );
      await reply(
        added
          ? `Added <@${add.id}> to the watchlist.`
          : `<@${add.id}> is already on the watchlist, added by <@${entry?.addedBy}>.`,
      );
      return;
    }

    const rows = await WatchlistService.list(guildId);
    if (!rows.length) {
      await reply("The watchlist is empty.");
      return;
    }
    let content = `**Watchlist** (${rows.length})`;
    let shown = 0;
    for (const row of rows) {
      const line = `\n<@${row.memberId}>, added by <@${row.addedBy}>`;
      if (content.length + line.length > 1950) break;
      content += line;
      shown++;
    }
    if (shown < rows.length) content += `\n…and ${rows.length - shown} more`;
    await reply(content);
  }
}
