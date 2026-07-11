import { AiChatService } from "@/core/services/ai/ai-chat.service";
import { AI_TOOLS } from "@/shared/ai/ai-tools";
import { BOT_NAME, NAME_TRIGGER_PATTERN } from "@/shared/config/branding";
import { ConfigValidator } from "@/shared/config/validator";
import { error } from "console";
import { Message, MessageFlags, TextChannel } from "discord.js";
import type { Client } from "discordx";

// Optional role-mention trigger: when a role named like the bot is pinged.
const MENTION_ROLE_NAME = BOT_NAME.toLowerCase();

export async function handleAiChatMessage(
  message: Message,
  client: Client,
): Promise<void> {
  if (!shouldRespond(message, client)) return;

  if ("sendTyping" in message.channel) {
    await message.channel.sendTyping();
  }

  if (isEmptyMessage(message)) {
    await message.reply({
      content: "if u are pinging me u should say something :/",
      flags: [MessageFlags.SuppressEmbeds],
    });
    return;
  }

  try {
    const response = await AiChatService.generateResponse(message, AI_TOOLS);

    if (!response || (!response.text && !response.gifUrl && !response.stickerId))
      return;

    const text = response.text || "";
    const chunks = splitMessage(text, 2000);
    const files = response.gifUrl
      ? [{ attachment: response.gifUrl, name: "reaction.gif" }]
      : undefined;
    const stickers = response.stickerId ? [response.stickerId] : undefined;

    let lastMessage = message;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      lastMessage = await replyResilient(lastMessage, {
        content: chunks[i] || undefined,
        files: isLast ? files : undefined,
        stickers: isLast ? stickers : undefined,
      });
    }

    if (!chunks.length && (files || stickers)) {
      await replyResilient(message, { files, stickers });
    }
  } catch (err) {
    const errorMessage = (err as Error).message;

    if (
      errorMessage.includes("MESSAGE_REFERENCE_UNKNOWN_MESSAGE") ||
      errorMessage.includes("Unknown message")
    ) {
      return;
    }

    error("AI chat error:", err);
  }
}

// Some server stickers are unavailable to the bot (Discord code 50081). Rather
// than let the whole reply throw, retry once without the sticker so the text
// still gets sent.
async function replyResilient(
  target: Message,
  payload: {
    content?: string;
    files?: { attachment: string; name: string }[];
    stickers?: string[];
  },
): Promise<Message> {
  const base = {
    allowedMentions: { users: [], roles: [] },
    flags: [MessageFlags.SuppressEmbeds] as const,
  };
  try {
    return await target.reply({ ...payload, ...base });
  } catch (err) {
    if (payload.stickers && (err as { code?: number }).code === 50081) {
      // Nothing left to send once the bad sticker is dropped.
      if (!payload.content && !payload.files?.length) return target;
      return await target.reply({ ...payload, stickers: undefined, ...base });
    }
    throw err;
  }
}

function shouldRespond(message: Message, client: Client): boolean {
  if (message.author.bot) return false;
  // Guild-only: this @On handler fires independently of main.ts's guard, so DMs
  // would otherwise reach the AI. Never respond outside a server.
  if (!message.guild) return false;
  if (!ConfigValidator.isFeatureEnabled("GOOGLE_GENERATIVE_AI_API_KEY"))
    return false;

  const mention = new RegExp(`^<@!?${client.user?.id}>`);
  const isMention = mention.test(message.content);
  const isRoleMention = message.mentions.roles.some(
    (role) => role.name.toLowerCase() === MENTION_ROLE_NAME,
  );
  const isReply = isReplyToBot(message, client);
  const isNameTrigger = NAME_TRIGGER_PATTERN
    ? NAME_TRIGGER_PATTERN.test(message.content)
    : false;

  return isMention || isRoleMention || isReply || isNameTrigger;
}

function isReplyToBot(message: Message, client: Client): boolean {
  if (!message.reference) return false;
  const channel = message.channel as TextChannel;
  const referencedMessage = channel.messages.cache.get(
    message.reference.messageId!,
  );
  return referencedMessage?.author.id === client.user?.id;
}

function isEmptyMessage(message: Message): boolean {
  const mention = new RegExp(`^<@[!&]?\\d+>\\s*`);
  let userMsg = message.content.replace(mention, "");
  if (NAME_TRIGGER_PATTERN) userMsg = userMsg.replace(NAME_TRIGGER_PATTERN, "");
  userMsg = userMsg.trim();

  return (
    !userMsg &&
    message.attachments.size === 0 &&
    message.stickers.size === 0 &&
    !message.reference
  );
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
