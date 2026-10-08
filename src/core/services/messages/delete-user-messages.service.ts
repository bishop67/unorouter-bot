import { userJailedEmbed } from "@/core/embeds/user-jailed.embed";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import { RolesService } from "@/core/services/roles/roles.service";
import { TicketService } from "@/core/services/tickets/ticket.service";
import { db } from "@/lib/db";
import { member, memberGuild, memberRole, role } from "@/lib/db-schema";
import { RecentMessagesService } from "@/core/services/messages/recent-messages.service";
import { and, eq, sql } from "drizzle-orm";
import { JAIL } from "@/shared/config/roles";
import type { DeleteUserMessagesParams } from "@/types";
import {
  ChannelType,
  DiscordAPIError,
  ForumChannel,
  Guild,
  GuildTextBasedChannel,
  RESTJSONErrorCodes,
  TextChannel,
  ThreadChannel,
  User,
} from "discord.js";
import { error, log } from "node:console";

const CHANNEL_CONCURRENCY = 3;
const MAX_DELETE_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        const value = await tasks[currentIndex]();
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
      runNext(),
    ),
  );
  return results;
}

export interface SweepResult {
  deleted: number;
  unreadable: string[];
}

// Never sweep the jail channel: it holds the appeal conversation, which is the one
// record staff need when reviewing whether a jail was correct.
const isJailChannel = (channel: { name?: string | null }) =>
  !!JAIL && !!channel.name?.toLowerCase().includes(JAIL.toLowerCase());

const isMissingAccess = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.MissingAccess ||
    err.code === RESTJSONErrorCodes.MissingPermissions);

async function deleteEach(channel: GuildTextBasedChannel, ids: string[]) {
  let deleted = 0;
  for (const id of ids) {
    try {
      await channel.messages.delete(id);
      deleted++;
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.UnknownMessage
      )
        continue;
      if (!isMissingAccess(err)) error(err);
      return { deleted, reachable: false };
    }
  }
  return { deleted, reachable: true };
}

export class DeleteUserMessagesService {
  // One sweep per member: a second one only halves the first's share of each
  // channel's rate limit.
  private static sweeping = new Set<string>();

  /**
   * Jail user and start message deletion in background.
   * Returns as soon as the jail is applied.
   */
  /**
   * Jail WITHOUT sweeping the member's history.
   *
   * Most jails here come from spam or a first-message catch, and wiping the
   * history destroys the evidence a mod needs to tell a real spammer from a
   * false positive. The offending message is still handled by whichever path
   * flagged it; staff can still sweep on purpose with /delete-user-messages.
   */
  static async jailMember(params: DeleteUserMessagesParams) {
    await this.jailUser(params);
  }

  /**
   * Apply jail role, update DB, send notification. Fast operation (~2s).
   */
  static async jailUser(params: DeleteUserMessagesParams) {
    const jailRoleId = RolesService.getGuildStatusRoles(params.guild)[JAIL]?.id;
    if (!jailRoleId) return;

    const memberId = params.user?.id || params.memberId;
    const discordMember =
      params.guild.members.cache.get(memberId) ||
      (await params.guild.members.fetch(memberId).catch(() => null));
    const alreadyJailed = discordMember?.roles.cache.has(jailRoleId);

    const jailDiscordRole = params.guild.roles.cache.get(jailRoleId);

    await db.transaction(async (tx) => {
      await tx
        .insert(member)
        .values({
          memberId: params.memberId,
          username: params.user?.username || "Unknown User",
        })
        .onConflictDoNothing();

      // Role entity is the FK parent for the association row below.
      await tx
        .insert(role)
        .values({
          roleId: jailRoleId,
          guildId: params.guild.id,
          name: jailDiscordRole?.name ?? JAIL,
          color: jailDiscordRole?.color || null,
          position: jailDiscordRole?.position ?? null,
        })
        .onConflictDoUpdate({
          target: role.roleId,
          set: {
            name: sql`excluded.name`,
            color: sql`excluded.color`,
            position: sql`excluded.position`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        });

      await tx
        .delete(memberRole)
        .where(
          and(
            eq(memberRole.memberId, params.memberId),
            eq(memberRole.guildId, params.guild.id),
          ),
        );

      await tx.insert(memberRole).values({
        roleId: jailRoleId,
        memberId: params.memberId,
        guildId: params.guild.id,
      });
    });

    // Replace ALL of the member's roles with only Jail: removing Verified (and any
    // others) is what actually isolates them - Jail can see only PRISON, and Verified
    // is denied PRISON view, so a jailed user must not keep Verified.
    const jailRole = params.guild.roles.cache.get(jailRoleId);
    if (discordMember && jailRole?.editable) {
      await discordMember.roles
        .set([jailRoleId], params.reason?.slice(0, 500) || "Jailed")
        .catch(() => discordMember.roles.add(jailRoleId).catch(error));
    }

    if (!alreadyJailed) {
      await this.sendJailNotification(params);
      await ModLogService.record(params.guild, {
        action: "User Jailed",
        targetId: params.memberId,
        moderatorId: params.moderatorId ?? params.guild.client.user.id,
        reason: params.reason,
      });
    }

    // Close any support tickets the jailed member had open so they can't keep
    // spamming through them (and the channels don't linger). Best-effort.
    await TicketService.closeAllForOpener(params.guild, params.memberId).catch(
      error,
    );
  }

  /** False while a sweep of this member already runs; release it when done. */
  static claimSweep(guildId: string, memberId: string) {
    const key = `${guildId}:${memberId}`;
    if (this.sweeping.has(key)) return false;
    this.sweeping.add(key);
    return true;
  }

  static releaseSweep(guildId: string, memberId: string) {
    this.sweeping.delete(`${guildId}:${memberId}`);
  }

  /**
   * Delete the member's messages from the last 14 days: what recent_messages
   * recorded, then with thorough a crawl of every channel for anything it missed.
   */
  static async deleteUserMessages(
    params: DeleteUserMessagesParams,
    thorough = false,
  ): Promise<SweepResult> {
    log(
      `[DeleteUserMessages] Starting message deletion for user ${params.memberId} in guild ${params.guild.name} (thorough: ${thorough})`,
    );
    const unreadable = new Set<string>();
    let deleted = await this.deleteRecorded(params, unreadable);
    if (thorough) deleted += await this.crawl(params, unreadable);
    log(
      `[DeleteUserMessages] Finished. Deleted ${deleted} messages total for user ${params.memberId}` +
        (unreadable.size ? `, unreadable: ${[...unreadable].join(", ")}` : ""),
    );
    return { deleted, unreadable: [...unreadable] };
  }

  private static async deleteRecorded(
    params: DeleteUserMessagesParams,
    unreadable: Set<string>,
  ) {
    const channels = await RecentMessagesService.byChannel(
      params.guild.id,
      params.memberId,
    );
    let deleted = 0;

    for (const [channelId, ids] of channels) {
      const channel =
        params.guild.channels.cache.get(channelId) ??
        (await params.guild.channels.fetch(channelId).catch(() => null));
      if (channel && !channel.isTextBased()) continue;
      if (channel && isJailChannel(channel)) continue;

      let reachable = true;
      for (let i = 0; channel && reachable && i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          deleted += (await channel.bulkDelete(batch, true)).size;
        } catch (err) {
          if (isMissingAccess(err)) {
            unreadable.add(`#${channel.name}`);
            reachable = false;
            break;
          }
          // A message already gone can fail the whole batch, so retry it one by one.
          const each = await deleteEach(channel, batch);
          deleted += each.deleted;
          if (!each.reachable) {
            unreadable.add(`#${channel.name}`);
            reachable = false;
          }
        }
      }
      // Kept while unreadable so a retry after a permission fix still finds them.
      if (reachable) await RecentMessagesService.forget(ids);
    }

    log(
      `[DeleteUserMessages] Deleted ${deleted} recorded messages across ${channels.size} channels`,
    );
    return deleted;
  }

  private static async crawl(
    params: DeleteUserMessagesParams,
    unreadable: Set<string>,
  ) {
    let totalDeleted = 0;
    const cutoff = Date.now() - MAX_DELETE_AGE_MS;

    const deleteMessages = async (channel: GuildTextBasedChannel) => {
      try {
        let deleted = 0;
        let lastMessageId: string | undefined;

        for (;;) {
          const messages = await channel.messages.fetch({
            limit: 100,
            ...(lastMessageId ? { before: lastMessageId } : {}),
          });
          if (messages.size === 0) break;

          lastMessageId = messages.last()!.id;

          // Stop if we've gone past the 14-day cutoff
          const oldestMessage = messages.last()!;
          const pastCutoff = oldestMessage.createdTimestamp < cutoff;

          const userMessages = messages.filter(
            (m) =>
              m.author.id === params.memberId && m.createdTimestamp >= cutoff,
          );

          if (userMessages.size > 0) {
            const result = await channel.bulkDelete(userMessages, true);
            deleted += result.size;
          }

          if (messages.size < 100 || pastCutoff) break;
        }

        if (deleted > 0) {
          log(
            `[DeleteUserMessages] Deleted ${deleted} messages in #${channel.name} (${channel.id})`,
          );
          totalDeleted += deleted;
        }
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          log(
            `[DeleteUserMessages] Channel ${channel.id} no longer exists, skipping`,
          );
          return;
        }
        if (isMissingAccess(err)) {
          unreadable.add(`#${channel.name}`);
          return;
        }
        error(err);
      }
    };

    const processThread = async (thread: ThreadChannel) => {
      try {
        await deleteMessages(thread as GuildTextBasedChannel);
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          log(
            `[DeleteUserMessages] Thread ${thread.id} no longer exists, skipping`,
          );
          return;
        }
        error(err);
      }
    };

    const channelTasks: (() => Promise<void>)[] = [];

    for (const channel of params.guild.channels.cache.values()) {
      if (isJailChannel(channel)) continue;
      if (channel.type === ChannelType.GuildForum) {
        channelTasks.push(async () => {
          const threads = await (channel as ForumChannel).threads
            .fetchActive()
            .catch(error);
          if (threads) {
            for (const thread of threads.threads.values()) {
              await processThread(thread);
            }
          }
        });
      } else if (
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildMedia,
        ].includes(channel.type)
      ) {
        channelTasks.push(() =>
          deleteMessages(channel as GuildTextBasedChannel),
        );
      } else if (
        [
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        ].includes(channel.type)
      ) {
        channelTasks.push(() => processThread(channel as ThreadChannel));
      }
    }

    log(
      `[DeleteUserMessages] Processing ${channelTasks.length} channels (concurrency: ${CHANNEL_CONCURRENCY})`,
    );
    await runWithConcurrency(channelTasks, CHANNEL_CONCURRENCY);
    log(`[DeleteUserMessages] Crawl deleted ${totalDeleted} more messages`);
    return totalDeleted;
  }

  private static async sendJailNotification(params: {
    guild: Guild;
    user: User | null;
    memberId: string;
    reason?: string;
    moderatorId?: string;
  }) {
    const jailChannel = params.guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.name.toLowerCase().includes("jail"),
    ) as TextChannel | undefined;

    if (!jailChannel) return;

    const dbMember = await db.query.member.findFirst({
      where: eq(member.memberId, params.memberId),
      with: {
        memberGuilds: {
          where: eq(memberGuild.guildId, params.guild.id),
          limit: 1,
        },
      },
    });

    const displayName =
      (dbMember?.memberGuilds as any)?.[0]?.nickname ||
      dbMember?.globalName ||
      dbMember?.username ||
      "Unknown";
    const username = dbMember?.username || "Unknown";

    const embed = userJailedEmbed({
      memberId: params.memberId,
      displayName,
      username,
      reason: params.reason,
      moderatorId: params.moderatorId,
    });

    await jailChannel.send({ embeds: [embed] }).catch(error);
  }
}
