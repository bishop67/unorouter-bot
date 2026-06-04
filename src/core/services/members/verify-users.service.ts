import { MemberDataService } from "@/core/services/members/member-data.service";
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
      await MemberDataService.upsertGuild(guild);

      const members = await guild.members.fetch();
      const nonBots = members.filter((m) => !m.user.bot);
      const total = nonBots.size;
      if (total === 0) {
        await channel.send("No members to process.");
        return;
      }

      const progress = await channel.send(
        `Syncing ${total} members (DB + Verified role)...`,
      );
      let done = 0;
      let verified = 0;
      let failed = 0;

      for (const m of nonBots.values()) {
        try {
          // Always upsert member + roles into DB so the audit table stays fresh
          // even when no role change is needed.
          await MemberDataService.updateCompleteMemberData(m);

          // Skip role add for jailed users; everyone else gets Verified if
          // they don't already have it.
          const isJailed =
            JAIL && m.roles.cache.some((r) => r.name === JAIL);
          if (!isJailed && !m.roles.cache.has(verifiedRole.id)) {
            await m.roles.add(verifiedRole, "Bulk verify");
            verified++;
          }
        } catch (e) {
          failed++;
          logger.error("Bulk verify failed for member", {
            member: m.id,
            error: String(e),
          });
        }
        done++;
        if (done % 25 === 0 || done === total) {
          await progress
            .edit(
              `Syncing: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
            )
            .catch(() => {});
        }
      }

      await progress
        .edit(
          failed > 0
            ? `Done. Synced ${total - failed}/${total} (${verified} newly verified, ${failed} failed).`
            : `Done. Synced ${total} members (${verified} newly verified).`,
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
