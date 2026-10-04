import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import { RolesService } from "@/core/services/roles/roles.service";
import {
  isHelper,
  isModerator,
  isStaff,
  safeDeferReply,
  safeEditReply,
  STAFF_COMMAND_PERMISSION,
} from "@/core/utils/command.utils";
import { JAIL } from "@/shared/config/roles";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class DeleteUserMessages {
  @Slash({
    name: "delete-user-messages",
    description: "Delete a user's messages across all channels (last 14 days)",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
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

    if (!/^\d{17,20}$/.test(memberId)) {
      await safeEditReply(interaction, "user-id must be a Discord user ID.");
      return;
    }

    if (jail) {
      if (!isModerator(interaction.member as GuildMember)) {
        await safeEditReply(interaction, "Only moderators can jail.");
        return;
      }
      const jailRole = JAIL
        ? RolesService.getGuildStatusRoles(interaction.guild)[JAIL]
        : undefined;
      if (!jailRole?.editable) {
        await safeEditReply(
          interaction,
          "Jail failed, the jail role is missing or above the bot's role.",
        );
        return;
      }
      const target = await interaction.guild.members
        .fetch(memberId)
        .catch(() => null);
      if (target && (target.user.bot || isHelper(target))) {
        await safeEditReply(
          interaction,
          "Staff and bots cannot be jailed with this command.",
        );
        return;
      }
    }

    const params = {
      guild: interaction.guild,
      memberId,
      jail,
      user: user ?? null,
      reason: reason || "Manual moderation",
      moderatorId: interaction.user.id,
    };

    // Recorded before the sweep so a restart mid-run cannot lose the entry; the
    // count is filled in once the sweep ends.
    const logged = await ModLogService.record(params.guild, {
      action: "Messages Deleted",
      targetId: memberId,
      moderatorId: params.moderatorId,
      reason: params.reason,
    });
    const sweep = () =>
      DeleteUserMessagesService.deleteUserMessages(params)
        .then((amount) => ModLogService.setAmount(logged, amount))
        .catch(() => {});

    if (jail) {
      await DeleteUserMessagesService.jailUser(params);
      sweep();
      await safeEditReply(
        interaction,
        "User jailed. Messages are being deleted in the background.",
      );
      return;
    }

    sweep();
    await safeEditReply(
      interaction,
      "Message deletion started in the background.",
    );
  }
}
