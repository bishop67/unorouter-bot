import "@dotenvx/dotenvx/config";

import { logger } from "@/lib/logger";
import { BoostService } from "@/core/services/boost/boost.service";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { WEBSITE_URL } from "@/shared/config/branding";
import { ConfigValidator } from "@/shared/config/validator";
import { ErrorBoundary } from "@/bot/guards/error-boundary.guard";
import { startWebhookServer } from "@/elysia";
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

// Global discordx guard. Wraps every handler (slash, button, modal,
// simple-command, gateway @On) in try/catch + structured log + ephemeral
// fallback reply on interactions. discordx has no built-in error middleware
// so this is the idiomatic boundary.
bot.guards = [ErrorBoundary];

bot.once("clientReady", async () => {
  await bot.initApplicationCommands();
  BoostService.startCron();
  // Seed guilds first: child writes (member_roles, member_messages) FK to it.
  await Promise.all(
    bot.guilds.cache.map((g) => MemberDataService.upsertGuild(g)),
  );
  startWebhookServer();
  logger.info("Bot started", { clientId: bot.user?.id });
});

bot.on("guildCreate", (guild) => void MemberDataService.upsertGuild(guild));

bot.on("interactionCreate", (interaction) => {
  if (!interaction.guild) return;
  void bot.executeInteraction(interaction);
});

bot.on("messageCreate", (message) => {
  if (!message.guild) return;
  void bot.executeCommand(message);
});

// Last-resort nets. The ErrorBoundary guard catches anything inside a discordx
// handler; these catch errors outside (timers, raw promise chains, gateway).
// Without them Node kills the process on unhandled rejection (>=15) / always
// on uncaught exception.
process.on("unhandledRejection", (reason) =>
  logger.error("Unhandled rejection", { error: String(reason) }),
);
process.on("uncaughtException", (err) =>
  logger.error("Uncaught exception", { error: String(err) }),
);
bot.on("error", (err) => logger.error("Client error", { error: String(err) }));
bot.on("shardError", (err) =>
  logger.error("Shard error", { error: String(err) }),
);

const main = async () => {
  if (!token) {
    logger.error("Could not find TOKEN in environment");
    throw new Error("Could not find TOKEN in your environment");
  }

  await bot.login(token);

  const activity = process.env.BOT_ACTIVITY?.trim() || WEBSITE_URL;
  bot.user?.setPresence({
    activities: [{ name: activity, type: ActivityType.Watching }],
  });
};

main();
