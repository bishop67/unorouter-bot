import {
  extractCodeFromAttachments,
  extractImageUrls,
} from "@/shared/ai/attachment-processor";
import { buildChatSystemPrompt } from "@/shared/ai/prompts";
import {
  googleClient,
  ImageDownloadError,
} from "@/shared/integrations/google-ai";
import { logger } from "@/lib/logger";
import { generateText, ModelMessage, stepCountIs } from "ai";
import { GuildMember, Message } from "discord.js";
import { LRUCache } from "lru-cache";
import { AiContextService } from "./ai-context.service";
import { NAME_TRIGGER_PATTERN } from "@/shared/config/branding";
import { isStaff } from "@/core/utils/command.utils";
import { LEVEL_ROLES } from "@/shared/config/roles";
import type { ChatPromptContext } from "@/shared/ai/prompts";
import type { AiChatResponse } from "@/types";

const CONNECTED_ROLE = process.env.CONNECTED_ROLE?.trim() || "";

// Roles the bot manages internally; surfacing them to the user as "their roles"
// adds noise, so they're filtered out of the public role list.
const INTERNAL_ROLES = new Set(
  [CONNECTED_ROLE, ...LEVEL_ROLES].filter(Boolean).map((r) => r.toLowerCase()),
);

const channelMessages = new LRUCache<string, ModelMessage[]>({ max: 1000 });

export class AiChatService {
  static async generateResponse(
    message: Message,
    tools: Record<string, any>,
  ): Promise<AiChatResponse | null> {
    const userMsg = this.extractUserMessage(message);
    const { replyContext, repliedImages } =
      await AiContextService.getReplyContext(message);

    let attachmentContext = "";
    if (message.attachments.size > 0) {
      const codeContent = await extractCodeFromAttachments(message);
      if (codeContent) {
        attachmentContext = `\n\n[Code from attachment]:\n${codeContent}`;
      }
    }

    const fullMessage = `${userMsg}${attachmentContext}${replyContext}`;

    const messageImages = await extractImageUrls(message);
    const allImages = [...messageImages, ...repliedImages];

    const speaker = this.speakerLabel(message);
    let userMessage = this.buildUserMessage(fullMessage, allImages, speaker);
    const messages = channelMessages.get(message.channel.id) || [];
    messages.push(userMessage);

    const system = buildChatSystemPrompt(this.buildPromptContext(message));

    const runAI = async () => {
      return googleClient.executeWithRotation(async (model) => {
        return generateText({
          model,
          system,
          messages: [...messages],
          tools,
          stopWhen: stepCountIs(8),
          maxOutputTokens: 1024,
          maxRetries: 0,
        });
      });
    };

    let result;
    try {
      result = await runAI();
    } catch (error) {
      if (error instanceof ImageDownloadError) {
        logger.warn("Retrying AI request without images");
        userMessage = this.buildUserMessage(fullMessage, [], speaker);
        for (let i = 0; i < messages.length; i++) {
          messages[i] = this.stripImagesFromMessage(messages[i]);
        }
        messages[messages.length - 1] = userMessage;
        result = await runAI();
      } else {
        throw error;
      }
    }

    if (!result) {
      logger.warn("AI returned null result");
      return null;
    }

    const { text, steps } = result;
    const responseText = await this.repairEmojiTags(
      this.stripFakeGifUrls(text?.trim() || ""),
      message,
    );

    logger.info("AI response", {
      hasText: !!responseText,
      textLength: responseText.length,
      hasSteps: !!steps?.length,
    });

    messages.push({ role: "assistant", content: responseText });
    channelMessages.set(message.channel.id, messages);

    return {
      text: responseText,
      gifUrl: this.extractGifFromSteps(steps),
      stickerId: this.extractStickerFromSteps(steps),
    };
  }

  private static buildPromptContext(message: Message): ChatPromptContext {
    const member = message.member;
    const channelName =
      "name" in message.channel && message.channel.name
        ? message.channel.name
        : "a channel";

    const heldRoleNames = member
      ? new Set(member.roles.cache.map((role) => role.name))
      : new Set<string>();

    // LEVEL_ROLES is low -> high; the member's rank is the highest tier they hold.
    let currentLevelIndex = -1;
    for (let i = 0; i < LEVEL_ROLES.length; i++) {
      if (heldRoleNames.has(LEVEL_ROLES[i])) currentLevelIndex = i;
    }
    const currentLevelRole =
      currentLevelIndex >= 0 ? LEVEL_ROLES[currentLevelIndex] : null;
    const nextLevelRole = LEVEL_ROLES[currentLevelIndex + 1] ?? null;

    const roles = [...heldRoleNames].filter(
      (name) => name !== "@everyone" && !INTERNAL_ROLES.has(name.toLowerCase()),
    );

    return {
      username: message.author.username,
      displayName: member?.displayName || message.author.globalName || "",
      channelName,
      channelId: message.channel.id,
      guildId: message.guild?.id || "",
      isStaff: isStaff(member),
      isLinked: this.hasRole(member, CONNECTED_ROLE),
      isBooster: !!member?.premiumSince,
      currentLevelRole,
      nextLevelRole,
      levelLadder: LEVEL_ROLES,
      roles,
    };
  }

  private static hasRole(
    member: GuildMember | null,
    roleName: string,
  ): boolean {
    if (!member || !roleName) return false;
    return member.roles.cache.some((role) => role.name === roleName);
  }

  private static extractUserMessage(message: Message): string {
    const mentionPattern = new RegExp(`^<@[!&]?\\d+>\\s*`);

    let content = message.content.replace(mentionPattern, "");
    if (NAME_TRIGGER_PATTERN) {
      content = content.replace(NAME_TRIGGER_PATTERN, "");
    }
    return content.trim();
  }

  // Shared channel history mixes many speakers into one user role, so prefix
  // each turn with the author's name to keep "who said what" legible.
  private static buildUserMessage(
    text: string,
    images: string[],
    speaker?: string,
  ): ModelMessage {
    const labeled = speaker ? `${speaker}: ${text}` : text;
    if (images.length > 0) {
      return {
        role: "user",
        content: [
          { type: "text", text: labeled },
          ...images.map((url) => ({
            type: "image" as const,
            image: url,
          })),
        ],
      };
    }
    return { role: "user", content: labeled };
  }

  private static speakerLabel(message: Message): string {
    return (
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username
    );
  }

  private static stripImagesFromMessage(msg: ModelMessage): ModelMessage {
    if (Array.isArray(msg.content)) {
      const filtered = (msg.content as any[]).filter(
        (part) => part.type !== "image",
      );
      if (filtered.length === 0) return { role: "user", content: "" };
      if (filtered.length === 1 && filtered[0].type === "text") {
        return { role: "user", content: filtered[0].text } as ModelMessage;
      }
      return { role: "user", content: filtered } as ModelMessage;
    }
    return msg;
  }

  private static stripFakeGifUrls(text: string): string {
    // Strip hallucinated GIF URLs and broken markdown images from models that can't use tools
    let cleaned = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/https?:\/\/media\.tenor\.com\/[^\s)>\]]+/gi, "")
      .replace(/https?:\/\/[^\s)>\]]*klipy\.com\/[^\s)>\]]+/gi, "")
      .replace(/https?:\/\/[^\s)>\]]*giphy\.[^\s)>\]]+/gi, "")
      .replace(/https?:\/\/[^\s)>\]]*\.gif(?:\?[^\s)>\]]*)?/gi, "");

    // Strip hallucinated structured JSON blocks some models emit instead of using the tool
    // e.g. {"text": "...", "gif": "searchMemeGifs query: ..."} or multiline variants
    cleaned = cleaned.replace(
      /\{\s*"text"\s*:\s*"[^"]*"\s*,\s*"gif"\s*:\s*"[^"]*"\s*\}/gs,
      "",
    );

    // If the entire response was a JSON wrapper, try to extract meaningful text from it
    const jsonWrapper = text.match(
      /^\s*\{\s*"text"\s*:\s*"([^"]*)"\s*,\s*"gif"\s*:\s*"[^"]*"\s*\}\s*$/s,
    );
    if (jsonWrapper && !cleaned.trim()) {
      cleaned = jsonWrapper[1];
    }

    // Normalize AI-tell punctuation to plain ASCII so replies read like a
    // person typed them: em/en dashes to " - ", ellipsis glyph to "...".
    cleaned = cleaned
      .replace(/\s*[—–]\s*/g, " - ")
      .replace(/…/g, "...");

    return cleaned.replace(/\n{3,}/g, "\n\n").trim();
  }

  // Models mangle custom emojis two ways: they emit an animated emoji with the
  // static `<:name:id>` syntax (renders as nothing), or they drop the `<...:id>`
  // wrapper entirely and write a bare `:name:` shortcode (Discord doesn't
  // resolve shortcodes for bot messages, so it shows as literal text). Repair
  // both against the guild's own emoji cache, then tidy leftover whitespace.
  private static async repairEmojiTags(
    text: string,
    message: Message,
  ): Promise<string> {
    if (!text.includes(":") || !message.guild) return text;
    // Cache can be empty right after a restart; fetch so shortcodes still resolve.
    let emojis = message.guild.emojis.cache;
    if (!emojis.size) {
      emojis = await message.guild.emojis.fetch().catch(() => emojis);
    }
    if (!emojis.size) return text;

    const byName = new Map(
      emojis.map((emoji) => [emoji.name?.toLowerCase() ?? "", emoji]),
    );

    let out = text.replace(
      /<(a?):([a-zA-Z0-9_]+):(\d+)>/g,
      (full, _a, name, id) => {
        const emoji = emojis.get(id);
        if (!emoji) return full;
        return `<${emoji.animated ? "a" : ""}:${emoji.name ?? name}:${id}>`;
      },
    );

    // Bare `:name:` shortcodes not already part of a full `<...:id>` tag.
    // Real ones become the full tag; the rest are hallucinated emojis the model
    // invented (never returned by getServerExpressions), so drop them entirely.
    out = out.replace(/(^|[^<\w]):([a-zA-Z0-9_]+):(?!\d)/g, (full, pre, name) => {
      const emoji = byName.get(name.toLowerCase());
      if (emoji) {
        return `${pre}<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
      }
      return pre;
    });

    return out.replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?])/g, "$1").trim();
  }

  private static extractGifFromSteps(steps: any[]): string | null {
    if (!steps?.length) return null;

    for (const step of steps) {
      const gifResult = step.toolResults?.find(
        (result: any) => result.toolName === "searchMemeGifs",
      );
      if (gifResult?.output?.success && gifResult.output.gifUrl) {
        return gifResult.output.gifUrl;
      }
    }
    return null;
  }

  private static extractStickerFromSteps(steps: any[]): string | null {
    if (!steps?.length) return null;

    for (const step of steps) {
      const stickerResult = step.toolResults?.find(
        (result: any) => result.toolName === "sendServerSticker",
      );
      if (stickerResult?.output?.success && stickerResult.output.stickerId) {
        return stickerResult.output.stickerId;
      }
    }
    return null;
  }
}
