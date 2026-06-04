import { logger } from "@/lib/logger";
import { JAIL, VERIFIED } from "@/shared/config/roles";
import type { Guild, TextChannel } from "discord.js";

export class VerifyAllUsersService {
  private static running = new Set<string>();

  static isRunning(guildId: string): boolean {
    return this.running.has(guildId);
  }

  /**
   * Give every non-bot, non-jailed member the Verified role. Jailed members are
   * left untouched (they must keep only Jail). Reports progress in the channel.
   */
  static async verifyAll(guild: Guild, channel: TextChannel): Promise<void> {
    if (this.running.has(guild.id)) {
      await channel.send("Verification already running.");
      return;
    }
    const verifiedRole = guild.roles.cache.find((r) => r.name === VERIFIED);
    if (!verifiedRole || !verifiedRole.editable) {
      await channel.send(
        `Verified role "${VERIFIED}" not found or not editable (move the bot role above it).`,
      );
      return;
    }

    this.running.add(guild.id);
    try {
      const members = await guild.members.fetch();
      const targets = members.filter(
        (m) =>
          !m.user.bot &&
          !m.roles.cache.has(verifiedRole.id) &&
          !(JAIL && m.roles.cache.some((r) => r.name === JAIL)),
      );

      const total = targets.size;
      if (total === 0) {
        await channel.send("All members already verified.");
        return;
      }

      const progress = await channel.send(`Verifying ${total} members...`);
      let done = 0;
      let failed = 0;

      for (const member of targets.values()) {
        try {
          await member.roles.add(verifiedRole, "Bulk verify");
        } catch (e) {
          failed++;
          logger.error("Bulk verify failed for member", {
            member: member.id,
            error: String(e),
          });
        }
        done++;
        if (done % 25 === 0 || done === total) {
          await progress
            .edit(
              `Verifying: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
            )
            .catch(() => {});
        }
      }

      await progress
        .edit(
          failed > 0
            ? `Done. Verified ${total - failed}/${total} (${failed} failed).`
            : `Done. Verified ${total} members.`,
        )
        .catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Bulk verify failed", { error: msg });
      await channel.send(`Error: ${msg}`);
    } finally {
      this.running.delete(guild.id);
    }
  }
}
