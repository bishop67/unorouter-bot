import { RaffleService } from "@/core/services/giveaway/raffle.service";
import {
  isAdmin,
  safeDeferReply,
  safeEditReply,
} from "@/core/utils/command.utils";
import { RAFFLE_MAX_DURATION_DAYS } from "@/shared/config/giveaway";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class RaffleCommands {
  @Slash({
    name: "raffle-start",
    description: "Start a one-off raffle for an item or code",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async start(
    @SlashOption({
      name: "duration",
      description: "How long it runs, e.g. 30s, 45m, 2h, 7d",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    duration: string,
    @SlashOption({
      name: "prize",
      description: "What is being given away, e.g. 3 months Discord Nitro",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    prize: string,
    @SlashOption({
      name: "code",
      description: "Code DMed to the winner. Leave empty to hand it over yourself",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    code: string | undefined,
    @SlashOption({
      name: "verified-only",
      description: "Restrict entry to members who linked their account",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    verifiedOnly: boolean | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const durationMs = RaffleService.parseDuration(duration);
    if (!durationMs) {
      await safeEditReply(
        interaction,
        `Could not read "${duration}". Use a number plus s/m/h/d (e.g. \`2h\`), up to ${RAFFLE_MAX_DURATION_DAYS} days.`,
      );
      return;
    }

    const channel = RaffleService.channel(guild);
    if (!channel) {
      await safeEditReply(interaction, "Giveaway channel not found.");
      return;
    }

    const raffle = await RaffleService.create({
      guild,
      channel,
      prize,
      code: code?.trim() || null,
      durationMs,
      verifiedOnly: verifiedOnly ?? false,
      createdByMemberId: interaction.user.id,
    });
    if (!raffle) {
      await safeEditReply(interaction, "Could not create the raffle.");
      return;
    }

    await safeEditReply(
      interaction,
      [
        `Raffle **#${raffle.id}** started in ${channel}.`,
        code?.trim()
          ? "The code will be DMed to the winner automatically."
          : "No code set - you will hand the prize over yourself.",
      ].join("\n"),
    );
  }

  @Slash({
    name: "raffle-end",
    description: "End a raffle now and draw the winner",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async end(
    @SlashOption({
      name: "raffle-id",
      description: "Raffle number (see /raffle-list)",
      required: true,
      minValue: 1,
      type: ApplicationCommandOptionType.Integer,
    })
    raffleId: number,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const raffle = await RaffleService.byId(raffleId, guild.id);
    if (!raffle) {
      await safeEditReply(interaction, `No raffle #${raffleId} here.`);
      return;
    }
    if (raffle.endedAt) {
      await safeEditReply(interaction, `Raffle #${raffleId} already ended.`);
      return;
    }

    const winner = await RaffleService.end(guild, raffle);
    await safeEditReply(
      interaction,
      winner
        ? `Raffle #${raffleId} ended. Winner: <@${winner.memberId}>${winner.dmSent ? "" : " (DM failed - hand the prize over yourself)"}`
        : `Raffle #${raffleId} ended with no entries.`,
    );
  }

  @Slash({
    name: "raffle-reroll",
    description: "Draw a replacement winner for an ended raffle",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async reroll(
    @SlashOption({
      name: "raffle-id",
      description: "Raffle number to reroll",
      required: true,
      minValue: 1,
      type: ApplicationCommandOptionType.Integer,
    })
    raffleId: number,
    @SlashOption({
      name: "new-code",
      description: "Fresh code - the first winner already received the old one",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    newCode: string | undefined,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const raffle = await RaffleService.byId(raffleId, guild.id);
    if (!raffle) {
      await safeEditReply(interaction, `No raffle #${raffleId} here.`);
      return;
    }

    const winner = await RaffleService.reroll(
      guild,
      raffle,
      newCode?.trim() || null,
    );
    await safeEditReply(
      interaction,
      winner
        ? `New winner for #${raffleId}: <@${winner.memberId}>${winner.dmSent ? "" : " (DM failed - hand the prize over yourself)"}`
        : `Nobody left to draw for #${raffleId}.`,
    );
  }

  @Slash({
    name: "raffle-list",
    description: "Raffles currently running",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async list(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    if (!isAdmin(interaction.member as GuildMember)) return;
    const guild = interaction.guild;
    if (!guild) return;

    const running = await RaffleService.running(guild.id);
    if (!running.length) {
      await safeEditReply(interaction, "No raffles running.");
      return;
    }
    const counts = await RaffleService.entryCounts(running.map((r) => r.id));
    await safeEditReply(
      interaction,
      running
        .map((r) => {
          const endsAt = Math.floor(new Date(r.endsAt).getTime() / 1000);
          return `**#${r.id}** ${r.prize} - ${counts.get(r.id) ?? 0} entries, ends <t:${endsAt}:R>${r.verifiedOnly ? " (verified only)" : ""}`;
        })
        .join("\n"),
    );
  }

  @Slash({
    name: "raffle-entries",
    description: "How many people have entered a raffle",
    dmPermission: false,
  })
  async entries(
    @SlashOption({
      name: "raffle-id",
      description: "Raffle number",
      required: true,
      minValue: 1,
      type: ApplicationCommandOptionType.Integer,
    })
    raffleId: number,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] })))
      return;
    const guild = interaction.guild;
    if (!guild) return;

    const raffle = await RaffleService.byId(raffleId, guild.id);
    if (!raffle) {
      await safeEditReply(interaction, `No raffle #${raffleId} here.`);
      return;
    }
    const count = await RaffleService.entryCount(raffle.id);
    const endsAt = Math.floor(new Date(raffle.endsAt).getTime() / 1000);
    await safeEditReply(
      interaction,
      [
        `**${raffle.prize}** - **${count}** ${count === 1 ? "entry" : "entries"}`,
        raffle.endedAt ? "This raffle has ended." : `Ends <t:${endsAt}:R>`,
      ].join("\n"),
    );
  }
}
