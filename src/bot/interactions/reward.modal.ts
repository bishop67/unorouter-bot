import type {
  APIModalInteractionResponseCallbackData,
  ModalSubmitInteraction,
} from "discord.js";
import { ComponentType, TextInputStyle } from "discord.js";

export const REWARD_MODAL_PREFIX = "reward_modal:";

// Tier amounts mirror the bug-bounty post: $0.25 Low / $0.50 Medium / $1 High
// / $50 Critical. Ascending order so the cheapest tier is the default-ish first
// option and staff escalate consciously. No custom amount.
export const REWARD_TIERS = [
  { label: "Low - $0.25", value: "0.25", description: "UI/cosmetic, typo, minor glitch" },
  { label: "Medium - $0.50", value: "0.5", description: "Functional bug with a workaround" },
  { label: "High - $1", value: "1", description: "Broken core feature, security flaw, money loss" },
  { label: "Critical - $50", value: "50", description: "Auth bypass, data leak, RCE, billing/quota exploit" },
] as const;

// discord.js 14 ModalBuilder doesn't expose LabelBuilder (Components V2) yet,
// so we hand-craft the raw modal payload. type 18 = Label, type 3 = String
// Select, type 4 = Text Input. discord.js still happily forwards this to the
// Discord API via interaction.showModal(APIModalInteractionResponseCallbackData).
export function buildRewardModal(
  source: "ticket" | "bug",
  sourceId: string,
  targetDiscordId: string,
): APIModalInteractionResponseCallbackData {
  return {
    custom_id: `${REWARD_MODAL_PREFIX}${source}:${sourceId}:${targetDiscordId}`,
    title: "Approve & Reward",
    components: [
      {
        type: 18,
        label: "Severity tier",
        component: {
          type: ComponentType.StringSelect,
          custom_id: "reward_tier",
          placeholder: "Pick a tier",
          required: true,
          min_values: 1,
          max_values: 1,
          options: REWARD_TIERS.map((t) => ({
            label: t.label,
            value: t.value,
            description: t.description,
          })),
        },
      },
      {
        type: 18,
        label: "Reason",
        component: {
          type: ComponentType.TextInput,
          custom_id: "reward_reason",
          style: TextInputStyle.Paragraph,
          required: true,
          placeholder: "e.g. Valid bug report: fixed login crash",
          max_length: 1000,
        },
      },
    ],
  };
}

interface ParsedRewardModal {
  source: string;
  sourceId: string;
  targetId: string;
  amount: number;
  reason: string;
}

export function parseRewardModal(
  interaction: ModalSubmitInteraction,
): ParsedRewardModal | null {
  const rest = interaction.customId.slice(REWARD_MODAL_PREFIX.length);
  const [source, sourceId, targetId] = rest.split(":");
  if (!source || !sourceId || !targetId) return null;

  // Select menus inside modals don't fire InteractionCreate; the picked values
  // live on interaction.fields like any other modal input. discord.js types
  // don't know about the select shape yet, so reach through the raw component
  // tree.
  const tier = readSelectValue(interaction, "reward_tier");
  if (!tier) return null;
  const amount = parseFloat(tier);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const reason = readTextValue(interaction, "reward_reason")?.trim();
  if (!reason) return null;

  return { source, sourceId, targetId, amount, reason };
}

function readSelectValue(
  interaction: ModalSubmitInteraction,
  customId: string,
): string | null {
  const raw = interaction.toJSON() as unknown as {
    data?: {
      components?: Array<{
        component?: { custom_id?: string; values?: string[] };
        components?: Array<{ custom_id?: string; values?: string[] }>;
      }>;
    };
  };
  const top = raw.data?.components ?? [];
  for (const row of top) {
    const inner = row.component ?? row.components?.[0];
    if (inner?.custom_id === customId && inner.values?.length) {
      return inner.values[0];
    }
  }
  return null;
}

function readTextValue(
  interaction: ModalSubmitInteraction,
  customId: string,
): string | null {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return null;
  }
}
