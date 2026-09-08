import type { REST } from "discord.js";
import { logger } from "@/lib/logger";

// Observe parsed REST results without consuming response streams or logging
// request bodies, webhook URLs, interaction tokens, or message content.
export function recordDiscordEvidence(rest: REST) {
  const sent = new Map<string, number>();
  const observed = new Map<string, { channelId: string; at: number; generation: number }>();
  let generation = 0;
  let readySince = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const item of observed) {
      const id = item[0];
      const entry = item[1];
      if (now - entry.at < 120_000) continue;
      const matched = sent.has(id);
      const complete = entry.generation === generation && entry.at - readySince >= 120_000;
      logger.info("Bot message correlation", {
        event: "security.discord_correlation",
        message_id: id,
        channel_id: entry.channelId,
        pod_uid: process.env.POD_UID,
        outcome: matched ? "matched_local_request" : complete ? "unmatched_in_this_process" : "coverage_gap",
        // A second replica or a response without a message ID can explain a miss.
        // This is a review lead, never proof of an external caller.
        scope: "process",
      });
      observed.delete(id);
    }
    for (const item of sent) if (now - item[1] > 600_000) sent.delete(item[0]);
  }, 5_000);
  timer.unref();
  const request = rest.request.bind(rest);
  rest.request = async (options) => {
    const channel = options.fullRoute.match(/^\/channels\/(\d+)\/messages(?:\/|$)/);
    const webhook = options.fullRoute.startsWith("/webhooks/");
    const interaction = options.fullRoute.startsWith("/interactions/");
    if (!channel && !webhook && !interaction) return request(options);
    const attempt = crypto.randomUUID();
    const metadata = {
      event: "security.discord_request",
      attempt_id: attempt,
      method: options.method,
      route_kind: channel ? "channel_message" : webhook ? "webhook" : "interaction",
      channel_id: channel?.[1],
      pod_uid: process.env.POD_UID,
      build: process.env.GIT_SHA,
    };
    logger.info("Discord request attempt", metadata);
    try {
      const result = await request(options);
      const message = result as { id?: unknown; channel_id?: unknown } | null;
      if (options.method === "POST" && typeof message?.id === "string" && typeof message?.channel_id === "string") {
        if (sent.size >= 10_000) {
          sent.clear();
          generation++;
        }
        sent.set(message.id, Date.now());
      }
      logger.info("Discord request completed", {
        ...metadata,
        event: "security.discord_result",
        outcome: "success",
        message_id: typeof message?.id === "string" ? message.id : undefined,
        channel_id: typeof message?.channel_id === "string" ? message.channel_id : metadata.channel_id,
      });
      return result;
    } catch (error) {
      logger.warn("Discord request failed", {
        ...metadata,
        event: "security.discord_result",
        outcome: "failure",
      });
      throw error;
    }
  };
  return {
    coverageChanged() {
      generation++;
      readySince = Date.now();
    },
    observe(messageId: string, channelId: string) {
      if (observed.size >= 10_000) {
        logger.warn("Discord evidence capacity reached", { event: "security.discord_coverage_gap", pod_uid: process.env.POD_UID });
        observed.clear();
        generation++;
      }
      observed.set(messageId, { channelId, at: Date.now(), generation });
    },
  };
}
