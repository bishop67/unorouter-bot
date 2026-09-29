import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import { RolesService } from "@/core/services/roles/roles.service";
import {
  isHelper,
  isModerator,
  safeDeferReply,
  safeEditReply,
  STAFF_COMMAND_PERMISSION,
} from "@/core/utils/command.utils";
import { JAIL, VERIFIED } from "@/shared/config/roles";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

const TIMEOUT_CHOICES = [
  { name: "5 minutes", value: 5 },
  { name: "10 minutes", value: 10 },
  { name: "30 minutes", value: 30 },
  { name: "1 hour", value: 60 },
  { name: "6 hours", value: 360 },
  { name: "1 day", value: 1440 },
  { name: "1 week", value: 10080 },
];

async function start(
  interaction: CommandInteraction,
  allowed: (member: GuildMember | null) => boolean,
): Promise<boolean> {
  if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
    return false;
  if (
    !interaction.guild ||
    !allowed(interaction.member as GuildMember | null)
  ) {
    await safeEditReply(
      interaction,
      "You are not allowed to use this command.",
    );
    return false;
  }
  return true;
}

async function fetchTarget(
  interaction: CommandInteraction,
  user: User,
): Promise<GuildMember | null> {
  const target = await interaction
    .guild!.members.fetch(user.id)
    .catch(() => null);
  if (!target) {
    await safeEditReply(interaction, `<@${user.id}> is not in the server.`);
    return null;
  }
  if (target.user.bot || isHelper(target)) {
    await safeEditReply(
      interaction,
      "Staff and bots cannot be moderated with this command.",
    );
    return null;
  }
  return target;
}

@Discord()
export class ModerationCommands {
  @Slash({
    name: "jail",
    description: "Jail a member (moderators)",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
  })
  async jail(
    @SlashOption({
      name: "user",
      description: "Member to jail",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Why (shown in the jail channel)",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ) {
    if (!(await start(interaction, isModerator))) return;
    const target = await fetchTarget(interaction, user);
    if (!target) return;

    await DeleteUserMessagesService.jailMember({
      guild: interaction.guild!,
      user,
      memberId: user.id,
      jail: true,
      reason: `${reason} (jailed by <@${interaction.user.id}>)`,
    });
    await safeEditReply(interaction, `Jailed <@${user.id}>.`);
  }

  @Slash({
    name: "unjail",
    description: "Release a member from jail (moderators)",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
  })
  async unjail(
    @SlashOption({
      name: "user",
      description: "Member to release",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!(await start(interaction, isModerator))) return;
    const target = await fetchTarget(interaction, user);
    if (!target) return;

    const roles = RolesService.getGuildStatusRoles(interaction.guild!);
    const jailRole = JAIL ? roles[JAIL] : undefined;
    const verifiedRole = VERIFIED ? roles[VERIFIED] : undefined;
    if (!jailRole || !target.roles.cache.has(jailRole.id)) {
      await safeEditReply(interaction, `<@${user.id}> is not jailed.`);
      return;
    }

    const audit = `Unjailed by ${interaction.user.username}`;
    await target.roles.remove(jailRole, audit);
    if (verifiedRole) await target.roles.add(verifiedRole, audit);
    await safeEditReply(interaction, `Released <@${user.id}> from jail.`);
  }

  @Slash({
    name: "timeout",
    description: "Time out a member (helpers and moderators)",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
  })
  async timeout(
    @SlashOption({
      name: "user",
      description: "Member to time out",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashChoice(...TIMEOUT_CHOICES)
    @SlashOption({
      name: "duration",
      description: "How long",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    minutes: number,
    @SlashOption({
      name: "reason",
      description: "Why (goes to the audit log)",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ) {
    if (!(await start(interaction, isHelper))) return;
    const target = await fetchTarget(interaction, user);
    if (!target) return;

    const ok = await target
      .timeout(minutes * 60_000, `${reason} (by ${interaction.user.username})`)
      .then(() => true)
      .catch(() => false);
    const label =
      TIMEOUT_CHOICES.find((c) => c.value === minutes)?.name ??
      `${minutes} minutes`;
    await safeEditReply(
      interaction,
      ok
        ? `Timed out <@${user.id}> for ${label}.`
        : "Timeout failed, check the bot's role position.",
    );
  }

  @Slash({
    name: "untimeout",
    description: "Remove a member's timeout (helpers and moderators)",
    dmPermission: false,
    defaultMemberPermissions: STAFF_COMMAND_PERMISSION,
  })
  async untimeout(
    @SlashOption({
      name: "user",
      description: "Member to release",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!(await start(interaction, isHelper))) return;
    const target = await fetchTarget(interaction, user);
    if (!target) return;

    await target
      .timeout(null, `Timeout removed by ${interaction.user.username}`)
      .catch(() => {});
    await safeEditReply(interaction, `Removed the timeout from <@${user.id}>.`);
  }
}
