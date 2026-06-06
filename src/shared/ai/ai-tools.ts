import { tool } from "ai";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";
import { ConfigValidator } from "@/shared/config/validator";
import { bot } from "@/main";

const KLIPY_API_KEY = process.env.KLIPY_API_KEY;
const KLIPY_BASE_URL = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}/gifs/search`;
const KLIPY_CUSTOMER_ID = process.env.BOT_NAME?.trim() || "unorouter-bot";

async function searchGifs(query: string, limit: number = 5): Promise<string[]> {
  if (!KLIPY_API_KEY) {
    logger.warn("KLIPY_API_KEY not configured - GIF search disabled");
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query,
      per_page: limit.toString(),
      content_filter: "off",
      format_filter: "gif",
      customer_id: KLIPY_CUSTOMER_ID,
    });

    const response = await fetch(`${KLIPY_BASE_URL}?${params}`);

    if (!response.ok) {
      throw new Error(`Klipy API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: boolean;
      data?: { data?: Array<{ file?: { md?: { gif?: { url?: string } } } }> };
    };

    return (
      data.data?.data
        ?.map((result: any) => result.file?.md?.gif?.url)
        .filter(Boolean) || []
    );
  } catch (error) {
    logger.error("Error fetching GIFs", { error: String(error) });
    return [];
  }
}

const gatherChannelContext = tool({
  description:
    "Gather recent messages and user context from a specific channel when you need more conversation history to provide better responses.",
  inputSchema: z.object({
    channelId: z
      .string()
      .describe("The Discord channel ID to fetch messages from"),
    guildId: z.string().describe("The Discord guild/server ID"),
    messageCount: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of recent messages to fetch (1-50)"),
  }),
  execute: async ({ channelId, guildId, messageCount }) => {
    try {
      logger.info("Gathering AI context", { channelId, guildId });
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return { success: false, error: "Guild not found" };
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return { success: false, error: "Channel not found or not text-based" };
      }

      const messages = await channel.messages.fetch({ limit: messageCount });
      const sortedMessages = Array.from(messages.values())
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .filter((msg) => !msg.author.bot);

      const messageContexts = sortedMessages.map((message) => ({
        timestamp: message.createdAt.toISOString(),
        author: {
          id: message.author.id,
          username: message.author.username,
          displayName: message.author.globalName,
        },
        content: message.content,
        hasAttachments: message.attachments.size > 0,
        isReply: !!message.reference,
        replyToId: message.reference?.messageId,
      }));

      return {
        success: true,
        context: {
          messageCount: messageContexts.length,
          messages: messageContexts,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error("Error gathering channel context", { error: String(error) });
      return {
        success: false,
        error: `Failed to gather channel context: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

const searchMemeGifs = tool({
  description:
    "Search for and send a meme GIF to enhance your response with visual humor.",
  inputSchema: z.object({
    query: z.string().describe("Search query for the GIF"),
  }),
  execute: async ({ query }: { query: string }) => {
    if (!ConfigValidator.isFeatureEnabled("KLIPY_API_KEY")) {
      return { success: false, error: "GIF search not available" };
    }

    const gifs = await searchGifs(query, 10);
    for (const gif of gifs) {
      try {
        const response = await fetch(gif, { method: "HEAD" });
        const size = parseInt(response.headers.get("content-length") ?? "0");
        if (size && size < 8 * 1024 * 1024) {
          return { success: true, gifUrl: gif };
        }
      } catch {
        continue;
      }
    }
    return { success: false, error: "No suitable GIF found" };
  },
});

export const AI_TOOLS = { searchMemeGifs, gatherChannelContext };
