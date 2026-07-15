import { userLevelEmbed } from "@/core/embeds/user-level.embed";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { inviteJoin, inviteSeed, memberMessages } from "@/lib/db-schema";
import { LEVEL_LIST } from "@/shared/config/levels";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { and, count, eq } from "drizzle-orm";

async function replyWithLevelStats(
  interaction: CommandInteraction,
  target: User,
) {
  const guild = interaction.guild;
  if (!guild) {
    await safeEditReply(interaction, "This command only works in a server.");
    return;
  }

  const [row] = await db
    .select({ count: count() })
    .from(memberMessages)
    .where(
      and(
        eq(memberMessages.memberId, target.id),
        eq(memberMessages.guildId, guild.id),
      ),
    );
  const messageCount = row?.count ?? 0;

  const [[seedRow], [joinRow]] = await Promise.all([
    db
      .select({ uses: inviteSeed.uses })
      .from(inviteSeed)
      .where(
        and(
          eq(inviteSeed.guildId, guild.id),
          eq(inviteSeed.inviterId, target.id),
        ),
      ),
    db
      .select({ count: count() })
      .from(inviteJoin)
      .where(
        and(
          eq(inviteJoin.guildId, guild.id),
          eq(inviteJoin.inviterId, target.id),
        ),
      ),
  ]);
  const inviteCount = (seedRow?.uses ?? 0) + (joinRow?.count ?? 0);

  const roleMention = (name: string) =>
    guild.roles.cache.find((r) => r.name === name)?.toString() ?? `\`${name}\``;

  const current =
    [...LEVEL_LIST].reverse().find((l) => messageCount >= l.count) ?? null;
  const next = LEVEL_LIST.find((l) => messageCount < l.count) ?? null;

  const member = await guild.members.fetch(target.id).catch(() => null);

  await safeEditReply(interaction, {
    embeds: [
      userLevelEmbed({
        displayName: member?.displayName ?? target.displayName,
        avatarUrl: (member ?? target).displayAvatarURL(),
        messageCount,
        inviteCount,
        currentRole: current ? roleMention(current.role) : null,
        nextRole: next ? roleMention(next.role) : null,
        currentThreshold: current?.count ?? 0,
        nextThreshold: next?.count ?? null,
      }),
    ],
    allowedMentions: { users: [], roles: [] },
  });
}

@Discord()
export class MeCommand {
  @Slash({
    name: "me",
    description: "See your level and progress to the next role",
    dmPermission: false,
  })
  async me(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction))) return;
    await replyWithLevelStats(interaction, interaction.user);
  }

  @Slash({
    name: "user",
    description: "See a member's level and progress to the next role",
    dmPermission: false,
  })
  async user(
    @SlashOption({
      name: "user",
      description: "Member to look up",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    target: User,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;
    await replyWithLevelStats(interaction, target);
  }
}
