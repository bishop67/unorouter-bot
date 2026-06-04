import "@dotenvx/dotenvx/config";

import { botLogger } from "@/lib/telemetry";
import { WEBSITE_URL } from "@/shared/config/branding";
import { ConfigValidator } from "@/shared/config/validator";
import { ActivityType, GatewayIntentBits, Partials } from "discord.js";
import { Client } from "discordx";
import "./bot";

ConfigValidator.validateConfig();

const token = process.env.TOKEN;
const guildIds = process.env.GUILD_IDS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
  silent: true,
  ...(guildIds && guildIds.length ? { botGuilds: guildIds } : {}),
});

bot.once("clientReady", async () => {
  await bot.initApplicationCommands();
  botLogger.info("Bot started", { clientId: bot.user?.id });
});

bot.on("interactionCreate", (interaction) => {
  if (!interaction.guild) return;
  void bot.executeInteraction(interaction);
});

bot.on("messageCreate", (message) => {
  if (!message.guild) return;
  void bot.executeCommand(message);
});

// Crash-guards. discordx invokes interaction/event handlers internally and has
// no first-class error middleware, so any promise rejection that escapes a
// handler bubbles up here. Without these listeners Node terminates the process
// on unhandled rejection (>=15) and always on uncaught exception, killing the
// bot mid-deploy. discord.js gateway-level errors land on client.{error,warn,
// shardError} instead and never reach process.
process.on("unhandledRejection", (reason) =>
  botLogger.error("Unhandled rejection", { error: String(reason) }),
);
process.on("uncaughtException", (err) =>
  botLogger.error("Uncaught exception", { error: String(err) }),
);

bot.on("error", (err) => botLogger.error("Client error", { error: String(err) }));
bot.on("warn", (msg) => botLogger.warn("Client warn", { msg }));
bot.on("shardError", (err) => botLogger.error("Shard error", { error: String(err) }));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    botLogger.info(`Received ${sig}, shutting down`);
    process.exit(0);
  });
}

const main = async () => {
  if (!token) {
    botLogger.error("Could not find TOKEN in environment");
    throw new Error("Could not find TOKEN in your environment");
  }

  await bot.login(token);

  const activity = process.env.BOT_ACTIVITY?.trim() || WEBSITE_URL;
  bot.user?.setPresence({
    activities: [{ name: activity, type: ActivityType.Watching }],
  });
};

main();
