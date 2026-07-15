import "@dotenvx/dotenvx/config";

import { logger } from "@/lib/logger";
import { BoostService } from "@/core/services/boost/boost.service";
import { InviteService } from "@/core/services/invites/invite.service";
import { MemberDataService } from "@/core/services/members/member-data.service";
import { VoteService } from "@/core/services/vote/vote.service";
import { WEBSITE_URL } from "@/shared/config/branding";
import { ConfigValidator } from "@/shared/config/validator";
import { ErrorBoundary } from "@/bot/guards/error-boundary.guard";
import { startWebhookServer } from "@/elysia";
import { ActivityType, GatewayIntentBits, type Guild, Partials } from "discord.js";
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
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildInvites,
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

// Per-guild boot sequence. Order matters: the guild row is the FK parent for
// member/role writes, and vote reconcile + member-count both need a warm member
// cache. Invite snapshot and cache warmup are independent, so they run together.
// Heavy backfills (level rewards, invite backlog) are NOT here - run `!verify`.
async function bootGuild(g: Guild): Promise<void> {
  await MemberDataService.upsertGuild(g);
  await Promise.all([
    InviteService.primeGuild(g),
    g.members.fetch().catch((e) =>
      logger.error("Member cache warmup failed", {
        guild: g.id,
        error: String(e),
      }),
    ),
  ]);
  await VoteService.reconcileRoleHolds(g).catch((e) =>
    logger.error("Vote hold reconcile failed", {
      guild: g.id,
      error: String(e),
    }),
  );
  void MemberDataService.updateMemberCount(g);
}

bot.once("clientReady", async () => {
  await bot.initApplicationCommands();
  BoostService.startCron();
  VoteService.startCron(bot);
  await Promise.all(bot.guilds.cache.map(bootGuild));
  // Keep member-count channels fresh even if a join/leave rename was rate-limited
  // (Discord caps channel renames at 2/10min).
  setInterval(
    () =>
      bot.guilds.cache.forEach(
        (g) => void MemberDataService.updateMemberCount(g),
      ),
    60 * 60 * 1000,
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
