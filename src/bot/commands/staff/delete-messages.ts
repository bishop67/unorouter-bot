import { MessagesService } from "@/core/services/messages/messages.service";
import {
  isStaff,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { logger } from "@/lib/logger";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type GuildTextBasedChannel,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

const BULK_DELETE_BATCH = 100;

@Discord()
export class DeleteMessagesCommand {
  @Slash({
    name: "delete-messages",
    description: "Delete the most recent messages in this channel",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
  })
  async deleteMessages(
    @SlashOption({
      name: "amount",
      description: "How many recent messages to delete (1-1000)",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: 1000,
    })
    amount: number,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isStaff(interaction.member as GuildMember)) return;

    const channel = interaction.channel as GuildTextBasedChannel | null;
    if (!channel || !interaction.guildId) {
      await safeEditReply(interaction, "Guild text channels only.");
      return;
    }
    if (!("bulkDelete" in channel)) {
      await safeEditReply(interaction, "This channel does not support bulk deletion.");
      return;
    }

    const messages = await MessagesService.fetchMessages(channel, amount);
    if (!messages.length) {
      await safeEditReply(interaction, "Nothing to delete here.");
      return;
    }

    let deleted = 0;
    for (let i = 0; i < messages.length; i += BULK_DELETE_BATCH) {
      const batch = messages.slice(i, i + BULK_DELETE_BATCH);
      const removed = await channel.bulkDelete(batch, true).catch((e) => {
        logger.error("delete-messages batch failed", {
          channel: channel.id,
          error: String(e),
        });
        return null;
      });
      if (removed) deleted += removed.size;
    }

    // bulkDelete silently ignores anything older than 14 days, so reporting the
    // requested amount would claim a purge that did not happen.
    const skipped = messages.length - deleted;
    logger.info("delete-messages run", {
      channel: channel.id,
      by: interaction.user.id,
      requested: amount,
      deleted,
      skipped,
    });

    await safeEditReply(
      interaction,
      [
        `Deleted **${deleted}** message${deleted === 1 ? "" : "s"}.`,
        ...(skipped > 0
          ? [`**${skipped}** skipped - Discord cannot bulk delete messages older than 14 days.`]
          : []),
      ].join("\n"),
    );
  }
}
