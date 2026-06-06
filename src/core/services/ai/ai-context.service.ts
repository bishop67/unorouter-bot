import { Collection, Message } from "discord.js";
import { logger } from "@/lib/logger";
import {
  extractCodeFromAttachments,
  extractImageUrls,
} from "@/shared/ai/attachment-processor";
import type { MessageContext, ReplyContext } from "@/types";

export class AiContextService {
  static async getReplyContext(message: Message): Promise<ReplyContext> {
    if (!message.reference) {
      return { replyContext: "", repliedImages: [] };
    }

    try {
      const repliedMessage = await message.channel.messages.fetch(
        message.reference.messageId!,
      );
      if (!repliedMessage) {
        return { replyContext: "", repliedImages: [] };
      }

      if (!repliedMessage.author.bot) {
        const messageContext = await this.gatherMessageContext(repliedMessage);
        const contextType = messageContext.context.includes("\n")
          ? "conversation"
          : "message";

        return {
          replyContext: `\n\nReplying to ${contextType}:\n"${messageContext.context}"`,
          repliedImages: messageContext.images,
        };
      }

      const botContent =
        repliedMessage.content.length > 500
          ? repliedMessage.content.substring(0, 500) + "..."
          : repliedMessage.content;

      return {
        replyContext: `\n\nUser is asking about this bot message:\n"${botContent}"`,
        repliedImages: await extractImageUrls(repliedMessage),
      };
    } catch {
      return { replyContext: "", repliedImages: [] };
    }
  }

  static async gatherMessageContext(
    repliedMessage: Message,
  ): Promise<MessageContext> {
    const userId = repliedMessage.author.id;
    const channel = repliedMessage.channel;
    const images: string[] = [];

    try {
      const [recentMessages, afterMessages] = await Promise.all([
        channel.messages.fetch({ limit: 50, before: repliedMessage.id }),
        channel.messages.fetch({ limit: 50, after: repliedMessage.id }),
      ]);

      const getUserMessages = (messages: Collection<string, Message>) =>
        Array.from(messages.values())
          .filter((msg) => msg.author.id === userId && !msg.author.bot)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      const beforeArray = getUserMessages(recentMessages).reverse();
      const afterArray = getUserMessages(afterMessages);

      const getConsecutiveMessages = (messages: Message[]): Message[] => {
        const result: Message[] = [];
        for (const msg of messages) {
          if (msg.author.id === userId) {
            result.push(msg);
          } else break;
        }
        return result;
      };

      const messagesBefore = getConsecutiveMessages(beforeArray);
      const messagesAfter = getConsecutiveMessages(afterArray);
      const allMessages = [...messagesBefore, repliedMessage, ...messagesAfter];

      const contextParts = await Promise.all(
        allMessages.map(async (msg) => {
          let content = msg.content?.trim() || "";

          if (msg.attachments.size > 0) {
            try {
              const msgImages = await extractImageUrls(msg);
              images.push(...msgImages);

              const codeContent = await extractCodeFromAttachments(msg);
              if (codeContent) {
                content += `\n\n[Code from attachment]:\n${codeContent}`;
              }
            } catch (err) {
              logger.error("Error processing attachments", {
                error: String(err),
              });
            }
          }

          return content;
        }),
      );

      const context = contextParts.filter(Boolean).join("\n") || "";
      return { context, images };
    } catch (err) {
      logger.error("Error fetching message context", { error: String(err) });
      return { context: repliedMessage.content || "", images: [] };
    }
  }
}
