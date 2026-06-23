import { STAFF_ROLES } from "@/shared/config/roles";
import { GuildMember, type TextChannel } from "discord.js";
import type {
  CommandInteraction,
  InteractionDeferReplyOptions,
  InteractionEditReplyOptions,
  MessagePayload,
} from "discord.js";

/**
 * Upsert a panel: delete the bot's previous panel messages (identified by a button
 * custom id) in this channel so re-running a /*-panel command never stacks duplicates.
 */
export async function purgeOwnPanels(
  channel: TextChannel,
  customId: string,
): Promise<void> {
  const me = channel.client.user?.id;
  if (!me) return;
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return;
  const hasCustomId = (component: unknown): boolean => {
    const c = component as {
      customId?: string;
      components?: unknown[];
    };
    if (c.customId === customId) return true;
    return Array.isArray(c.components) && c.components.some(hasCustomId);
  };
  const mine = recent.filter(
    (m) => m.author.id === me && m.components.some(hasCustomId),
  );
  for (const m of mine.values()) {
    await m.delete().catch(() => {});
  }
}

/**
 * Like purgeOwnPanels but matches the bot's previous panel by embed title prefix.
 * Used for panels whose buttons are link-style (no custom id to key on).
 */
export async function purgeOwnPanelsByTitle(
  channel: TextChannel,
  titlePrefix: string,
): Promise<void> {
  const me = channel.client.user?.id;
  if (!me) return;
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return;
  const mine = recent.filter(
    (m) =>
      m.author.id === me &&
      m.embeds.some((e) => e.title?.startsWith(titlePrefix)),
  );
  for (const m of mine.values()) {
    await m.delete().catch(() => {});
  }
}

const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_INTERACTION = 10062;

export async function safeDeferReply(
  interaction: CommandInteraction,
  options?: InteractionDeferReplyOptions,
): Promise<boolean> {
  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === UNKNOWN_INTERACTION) return false;
    throw error;
  }
}

export async function safeEditReply(
  interaction: CommandInteraction,
  options: string | MessagePayload | InteractionEditReplyOptions,
): Promise<boolean> {
  try {
    await interaction.editReply(options);
    return true;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (
      code === UNKNOWN_MESSAGE ||
      code === UNKNOWN_CHANNEL ||
      code === UNKNOWN_INTERACTION
    ) {
      return false;
    }
    throw error;
  }
}

export function isStaff(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (STAFF_ROLES.length === 0) return false;
  return member.roles.cache.some((role) => STAFF_ROLES.includes(role.name));
}
