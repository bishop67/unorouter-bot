# Vote reward flow per provider

Reference for how each vote site delivers a vote and how the bot rewards it.
Source: `src/core/services/vote/vote.service.ts`. Reward amount is
`VOTE_GRANT_DOLLARS` (currently `$0.05`) converted to quota via `dollarsToQuota()`.

## The two delivery mechanisms

| Site                   | Signal                                                | `ownsRole` | Bot strips role?                           | Dedupe window |
| ---------------------- | ----------------------------------------------------- | ---------- | ------------------------------------------ | ------------- |
| **Top.gg**             | Webhook (HMAC-SHA256, `x-topgg-signature`)            | n/a        | n/a                                        | 1h            |
| **Discords.com**       | Role add (`Server Voter`)                             | `false`    | Yes, after reward                          | 1h            |
| **Discadia**           | Role add (`Discadia Voter`)                           | `false`    | Yes, after reward                          | 1h            |
| **DiscordServers.com** | Role add (`DiscordServers Voter`) via VoteManager.xyz | `true`     | No (external bot removes on its 12h cycle) | 11h           |

Role names come from env: `DISCORDS_VOTE_ROLE`, `DISCADIA_VOTE_ROLE`,
`DISCORDSERVERS_VOTE_ROLE`. Blank disables the site.

## Webhook flow (Top.gg only)

1. Top.gg POSTs a signed webhook on each vote.
2. Route verifies HMAC-SHA256 of the raw body, replies HTTP 200 within 5s,
   rewards async (`rewardAsync`) so the reply never times out.
3. `reward()` dedupes on `reward_grants` (prior `vote/topgg` row within 1h),
   then grants quota. 1h window only guards Top.gg's ~17min retry storm, not
   real cadence (the site enforces that).

## Role flow (Discords, Discadia, DiscordServers)

1. The listing site (or VoteManager for DiscordServers) adds the site's vote
   role to the member on a successful vote.
2. Bot receives `guildMemberUpdate`, runs `handleVoteRole(newMember)`.
3. Transition is measured against `vote_role_holds` (unique `(member, site)`),
   NEVER against Discord's `oldMember` cache diff (an uncached oldMember after a
   restart reads every held role as just-added -> confirmed double-pay Jul 3).
4. On not-held -> held: upsert member row (FK), atomically `INSERT ... ON
CONFLICT DO NOTHING` a hold (only the insert winner pays), then `reward()`.
5. `reward()` dedupes on `reward_grants` (`vote/<site>` within the window),
   grants quota, logs `Vote rewarded`.
6. Role cleanup:
   - `ownsRole:false` (Discords, Discadia): bot **strips** the role after a
     successful reward so the next vote re-adds it and re-triggers.
   - `ownsRole:true` (DiscordServers): bot leaves the role; VoteManager removes
     it on its own ~12h cycle. The 11h dedupe spans that cycle so a spurious
     re-fire inside it never double-pays.
7. On role removed (owner-bot expiry or our strip): the hold is cleared to
   re-arm.

## Reconciliation (boot + periodic sweep)

`reconcileRoleHolds(guild)` replays role transitions against `vote_role_holds`:
role gained -> claim + reward (grant dedupe blocks re-pay), role lost -> clear
hold, and clears holds for members who left the guild so a rejoin + vote still
pays.

It runs in two places:

- **Boot**, after member-cache warmup (`main.ts`): catches transitions missed
  while the bot was down.
- **Periodic sweep** every `VOTE_SWEEP_INTERVAL_MS` (default 10min), via
  `VoteService.startCron(client)` (`main.ts`, next to the boost cron): catches a
  role added while the bot missed its live `guildMemberUpdate` mid-session. This
  is what clears a stuck owned role (Discords/Discadia) and pays the owed vote
  without waiting for a restart.

## Known failure modes (why a vote can miss a reward)

- **Missed `guildMemberUpdate`**: if the listing site never adds the role, or
  the gateway drops that single event, no reward fires and (for Discords/
  Discadia) the role is never stripped, so it can sit **uncleared** on the
  member. This is the most common "I voted but didn't get paid" and the "roles
  don't get cleaned up" report - same root cause. Discadia and Discords are the
  flakiest at actually assigning the role. The periodic sweep (above) clears a
  stuck role and pays the owed vote within `VOTE_SWEEP_INTERVAL_MS` (10min); a
  restart also catches it via boot reconciliation.
- **Grant failure**: `grantQuota` throws -> hold released, no pay, retried on
  the next member event. Logged `Vote grant failed`.
- **Not linked**: voter hasn't linked their Discord to a new-api account ->
  no pay yet, logged `voter not linked`, hold released and role KEPT (even
  `ownsRole:false` sites skip the strip). The role is the durable record of the
  unpaid vote: once they link, the next sweep (or the verify-channel claim
  button, which also runs `handleVoteRole`) pays it and then strips/clears as
  usual. A voter who never links keeps the role until an external bot removes
  it; the sweep retries (and logs) each cycle in the meantime.
- **Dedupe hit**: a legit re-fire inside the window -> logged `duplicate
delivery`, no pay (intended).

## Diagnosing a specific user (kubectl, read-only)

DB = CloudNativePG `bot-pg` cluster (namespace `databases`, db `unorouter-bot-db`, primary
pod `bot-pg-1`); bot logs = deploy/unorouter-bot in namespace `services`.
`KUBECONFIG=infra/kubeconfig`.

```bash
MID=<discord_id>
kubectl -n databases exec bot-pg-1 -c postgres -- \
  psql -U postgres -d unorouter-bot-db -c \
  "SELECT source_id AS site, quota, created_at FROM reward_grants \
    WHERE target_member_id='$MID' AND source_type='vote' ORDER BY created_at DESC LIMIT 20;"
# holds:
kubectl -n databases exec bot-pg-1 -c postgres -- \
  psql -U postgres -d unorouter-bot-db -c \
  "SELECT site, created_at FROM vote_role_holds WHERE member_id='$MID';"
# logs:
kubectl -n services logs deploy/unorouter-bot --since 3h 2>&1 | grep -iE "<site>|$MID|vote"
```

A missing site row with no `duplicate`/`failed` log line for that user =
the role event never reached the bot (site or gateway), not a bot bug.

```

```
