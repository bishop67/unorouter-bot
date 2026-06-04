import { logger } from "@/lib/logger";
import {
  BaseInteraction,
  InteractionType,
  Message,
  MessageFlags,
} from "discord.js";
import type { GuardFunction } from "discordx";

type GuardArg = unknown;

// Wraps every discordx-routed event (slash, button, modal, simple-command,
// gateway @On) in a try/catch. discordx has no first-class error middleware;
// without this any thrown error in a handler bubbles to process.unhandled
// Rejection where we can't reply to the user. Here we log + send a friendly
// ephemeral fallback when the source is an unacknowledged interaction.
export const ErrorBoundary: GuardFunction = async (arg, _client, next) => {
  try {
    await next();
  } catch (err) {
    const source = pickSource(arg);
    logger.error("Unhandled handler error", {
      error: err instanceof Error ? err.stack ?? err.message : String(err),
      kind: source.kind,
      id: source.id,
    });

    if (source.interaction && !source.interaction.replied && !source.interaction.deferred) {
      // best-effort: silently swallow if Discord already 3s'd the interaction
      const message = "Something went wrong. Try again in a moment.";
      await source.interaction
        .reply({ content: message, flags: [MessageFlags.Ephemeral] })
        .catch(() => {});
    } else if (source.interaction?.deferred) {
      await source.interaction
        .editReply("Something went wrong. Try again in a moment.")
        .catch(() => {});
    }
  }
};

function pickSource(arg: GuardArg) {
  // discordx may hand us a single event payload, an array of them, or a wrapper
  // (e.g. SimpleCommandMessage). Normalise to either an interaction or message.
  const item = Array.isArray(arg) ? arg[0] : arg;
  if (item instanceof BaseInteraction) {
    return {
      kind: InteractionType[item.type] ?? "interaction",
      id: item.id,
      interaction: item.isRepliable() ? item : null,
    };
  }
  if (item instanceof Message) {
    return { kind: "message", id: item.id, interaction: null };
  }
  // SimpleCommandMessage shape from discordx: { message: Message<true> }
  if (item && typeof item === "object" && "message" in item) {
    const m = (item as { message: unknown }).message;
    if (m instanceof Message) {
      return { kind: "simpleCommand", id: m.id, interaction: null };
    }
  }
  return { kind: "unknown", id: undefined, interaction: null };
}
