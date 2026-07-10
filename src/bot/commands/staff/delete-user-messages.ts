import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import {
  isStaff,
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
export class DeleteUserMessages {
  @Slash({
    name: "delete-user-messages",
    description: "Delete a user's messages across all channels (last 14 days)",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  })
  async deleteUserMessages(
    @SlashOption({
      name: "user",
      description: "Select existing user",
      type: ApplicationCommandOptionType.User,
    })
    user: User | undefined,
    @SlashOption({
      name: "user-id",
      description: "User ID whose messages should be deleted",
      type: ApplicationCommandOptionType.String,
    })
    userId: string | undefined,
    @SlashOption({
      name: "jail",
      description: "Also jail the user",
      type: ApplicationCommandOptionType.Boolean,
    })
    jail: boolean = false,
    @SlashOption({
      name: "reason",
      description: "Reason for jailing (shown in jail channel)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ) {
    if (
      !(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] }))
    )
      return;

    if (!isStaff(interaction.member as GuildMember)) {
      await safeEditReply(
        interaction,
        "You are not allowed to use this command.",
      );
      return;
    }

    const memberId = user?.id ?? userId;
    if (!memberId || !interaction.guild) {
      await safeEditReply(interaction, "Provide a user or user-id.");
      return;
    }

    const params = {
      guild: interaction.guild,
      memberId,
      jail,
      user: user ?? null,
      reason: reason
        ? `${reason} (triggered by <@${interaction.user.id}>)`
        : `Manual moderation (triggered by <@${interaction.user.id}>)`,
    };

    if (jail) {
      await DeleteUserMessagesService.jailUser(params);
      DeleteUserMessagesService.deleteUserMessages(params).catch(() => {});
      await safeEditReply(
        interaction,
        "User jailed. Messages are being deleted in the background.",
      );
      return;
    }

    DeleteUserMessagesService.deleteUserMessages(params).catch(() => {});
    await safeEditReply(
      interaction,
      "Message deletion started in the background.",
    );
  }
}
