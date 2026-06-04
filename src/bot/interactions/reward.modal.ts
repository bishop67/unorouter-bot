import {
  ModalIdBuilder,
  ModalIdPrefix,
  RewardModalField,
} from "@/types/custom-ids";
import type {
  APIModalInteractionResponseCallbackData,
  ModalSubmitInteraction,
} from "discord.js";
import { ComponentType, TextInputStyle } from "discord.js";

export interface RewardRecipientOption {
  id: string;
  label: string; // <= 100 chars
}

// Re-export so existing call sites can keep importing from here.
export const REWARD_MODAL_PREFIX = `${ModalIdPrefix.Reward}:`;

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
// Select, type 4 = Text Input, type 5 = User Select. discord.js forwards the
// shape verbatim to the Discord API via interaction.showModal(APIModal...).
//
// targetDiscordId encoded in the custom_id is the DEFAULT recipient (ticket
// opener / thread starter). For bug-bounty staff can override it via the
// UserSelect inside the modal because the real fixer may not be the thread
// starter; for tickets the opener is always the recipient so the field is
// omitted.
export function buildRewardModal(
  source: "ticket" | "bug",
  sourceId: string,
  defaultRecipientId: string,
  recipientOptions: RewardRecipientOption[] = [],
): APIModalInteractionResponseCallbackData {
  // UserSelect inside a modal can't be scoped to thread members (Discord limit),
  // so for bug-bounty we hand-build a StringSelect from the thread participants
  // the caller fetched. The default option puts the thread starter first.
  const cappedOptions = recipientOptions.slice(0, 25);
  const recipientField =
    source === "bug" && cappedOptions.length > 0
      ? [
          {
            type: 18,
            label: "Recipient",
            description:
              "Who finds the bug isn't always who reported it. Pick the user that gets paid.",
            component: {
              type: ComponentType.StringSelect,
              custom_id: RewardModalField.Recipient,
              placeholder: "Pick a thread participant",
              required: true,
              min_values: 1,
              max_values: 1,
              options: cappedOptions.map((o) => ({
                label: o.label.slice(0, 100),
                value: o.id,
                default: o.id === defaultRecipientId,
              })),
            },
          },
        ]
      : [];

  // Cast: the modal-side component types (Components V2 LabelComponent wrapping
  // a UserSelect with default_values) aren't fully expressed in discord.js
  // 14.26's APIModal* types yet, so we hand the runtime-correct object to
  // showModal() and tell TS to trust us.
  return {
    custom_id: ModalIdBuilder.reward(source, sourceId, defaultRecipientId),
    title: "Approve & Reward",
    components: [
      ...recipientField,
      {
        type: 18,
        label: "Severity tier",
        component: {
          type: ComponentType.StringSelect,
          custom_id: RewardModalField.Tier,
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
          custom_id: RewardModalField.Reason,
          style: TextInputStyle.Paragraph,
          required: true,
          placeholder: "e.g. Valid bug report: fixed login crash",
          max_length: 1000,
        },
      },
    ],
  } as unknown as APIModalInteractionResponseCallbackData;
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
  const [source, sourceId, defaultTargetId] = rest.split(":");
  if (!source || !sourceId || !defaultTargetId) return null;

  // Select menus inside modals don't fire InteractionCreate; the picked values
  // live on interaction.fields like any other modal input. discord.js types
  // don't know about the select shape yet, so reach through the raw component
  // tree.
  const tier = readSelectValue(interaction, RewardModalField.Tier);
  if (!tier) return null;
  const amount = parseFloat(tier);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const reason = readTextValue(interaction, RewardModalField.Reason)?.trim();
  if (!reason) return null;

  // For bug-bounty the UserSelect (required) wins over the default in the
  // custom_id; for tickets the field is absent so we fall back to the encoded
  // default (the opener).
  const targetId =
    readSelectValue(interaction, RewardModalField.Recipient) ?? defaultTargetId;

  return { source, sourceId, targetId, amount, reason };
}

function readSelectValue(
  interaction: ModalSubmitInteraction,
  customId: string,
): string | null {
  // discord.js camelCases the API payload, so `customId` (not `custom_id`)
  // and the components live at the top level of interaction.toJSON(), not
  // under `.data`. Label components (type 18) wrap a single child under
  // `.component`; action rows (type 1) put children under `.components`.
  type Node = {
    customId?: string;
    values?: string[];
    component?: Node;
    components?: Node[];
  };
  const walk = (n: Node): string | null => {
    if (n.customId === customId && Array.isArray(n.values) && n.values.length > 0) {
      return n.values[0]!;
    }
    if (n.component) {
      const v = walk(n.component);
      if (v) return v;
    }
    if (Array.isArray(n.components)) {
      for (const c of n.components) {
        const v = walk(c);
        if (v) return v;
      }
    }
    return null;
  };
  return walk(interaction.toJSON() as unknown as Node);
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

