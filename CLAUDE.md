# CLAUDE.md — unorouter-bot

Discord bot for unorouter.com. discordx (decorators), drizzle + postgres-js, Google Gemini for AI chat. Runs on the k3s cluster (namespace `services`, deploy `unorouter-bot`); ships via GHCR image + ArgoCD, never manual binaries.

## Stack

- Runtime: Node 22 (alpine in prod), bun in dev (`bun dev`)
- Framework: discordx 11 on discord.js 14
- DB: Drizzle ORM + postgres-js (`src/lib/db/`, schema in `src/lib/db-schema/`)
- AI: `@ai-sdk/google` with GoogleClientRotator (key rotation)
- Build: tsup → `dist/main.js`
- Env: dotenvx (`bun start` → `dotenvx run --env NODE_ENV=production -- node dist/main.js`)

## Deploy

k3s + ArgoCD. `.github/workflows/ghcr.yml` (push to main, or `gh workflow run ghcr.yml`)
builds the multi-arch image to `ghcr.io/unorouter/unorouter-bot:latest`. The k8s manifest
(`infra/infra/services/bot.yaml`, image `:latest`) then needs a
`kubectl -n services rollout restart deploy/unorouter-bot` to pull the new image (no image
updater wired yet). ArgoCD owns the manifest itself. The old `docker.yml` (don self-hosted
runner + `docker compose`) is DEAD - its push trigger was removed after the zombie-respawn
incident; do not re-enable. Local `docker build` fine for verifying compile only.

Runtime config comes from the k8s secret (OpenBao -> ESO), NOT GitHub secrets/dotenvx `.env`
anymore. To change a value: patch the OpenBao path feeding `bot-env`, then
`kubectl -n services rollout restart deploy/unorouter-bot`. `NEW_API_URL`/`DATABASE_URL` etc.
are injected as plain pod env (visible in `kubectl exec ... env`, no `.env` file on disk).

## Architecture

```
src/main.ts                                  bot entry, intents, lifecycle, crash guards
src/bot/index.ts                             discordx decorator loader (static imports only)
src/bot/commands/staff/                      slash commands: /grant /verify-panel /ticket-panel /verify-users
src/bot/events/                              gateway listeners: ai-chat, guild-member-add/-update, message-create, thread-create
src/bot/interactions/                        button + modal handlers: claim_connect, ticket_*, bug_*, reward_modal
src/core/services/grant/grant.service.ts     new-api /api/user/discord_grant client, connect/boost bonuses, log channel announce
src/core/services/server-tag/                server tag wear windows: $/day while the guild tag is worn
src/core/services/roles/                     role + jail isolation logic
src/core/services/messages/                  XP + level-up
src/core/utils/command.utils.ts              purgeOwnPanels, safeDefer/EditReply, isStaff
src/shared/config/                           env-driven branding, roles, levels, features
src/shared/utils/channel.utils.ts            NAME-substring channel resolution (emoji-rename resilient)
src/lib/telemetry.ts                         botLogger (PostHog + stdout)
src/lib/db-schema/                           drizzle schema: guild, member, memberGuild, memberRole, memberMessages, ticket, ticketMessage, bugReport, grantLog
```

### Boot (clientReady)

Kept lean. `bootGuild(g)` runs per guild in parallel, in order: upsert guild row (FK parent) -> prime invite snapshot + warm member cache (parallel) -> replay vote-role holds -> refresh member-count channels. Then an hourly member-count interval + the webhook server. Heavy backfills (level rewards, invite backlog) are NOT on boot - they loop every member/guild, so they live in the staff `!verify` command instead. Run `!verify` once after a deploy for a full reconcile.

### Member-count voice channels

Locked voice channels named like `📊│members:` auto-update to the live non-bot count. Config `MEMBERS_COUNT_CHANNELS` (comma-separated NAME substrings, GitHub secret + rendered in `docker.yml`). `MemberDataService.updateMemberCount(guild)` renames each matching channel to `<name> <count>` on guildMemberAdd/Remove + on boot + hourly. Discord caps channel renames at 2/10min per channel.

GOTCHA: for the bot to rename a locked channel it needs VIEW + MANAGE_CHANNELS on it. The bot's server role has MANAGE_CHANNELS globally, but a locked channel (deny CONNECT for @everyone) still blocked it until a **role overwrite** was added. Add the overwrite against the bot's GUILD ROLE id (type 0), NOT the app/client id as a member overwrite (type 1) - the app id is not the bot's member and the overwrite silently does nothing. After changing channel perms, RESTART the bot so discord.js re-caches the channel with the new overwrites, or it computes perms from the stale cache and keeps failing with `50001 Missing Access`.

### `!verify` (staff prefix command)

Full member reconcile, on demand: upsert every member into the DB, assign the Verified role (skip jailed), backfill any earned-but-unpaid level reward, and reconcile the invite backlog for the guild. Aliases: `!verify` (canonical), `!verify-user(s)`, `!verify-all`.

### `/members` (slash command)

Member overview: Users/Bots count, 30d/7d/24h memberflow, and a growth-chart PNG (QuickChart, built from live join dates - no DB history needed). `MemberDataService.memberFlowStats()` + `membersEmbed()`.

### Conventions

- Channel resolution by NAME substring via `findTextChannel(guild, "verify")` etc. Never store Discord IDs in code. Emoji renames (`verify` → `✅│verify`) keep working.
- Brand strings env-driven: `BOT_NAME`, `WEBSITE_URL`. No hardcoded "unorouter".
- All grant amounts ENV-DRIVEN IN DOLLARS. `src/shared/config/rewards.ts` is the ONE place the reward env vars are read (`REWARDS`), plus `dollarsToQuota()` (`QUOTA_PER_DOLLAR`, default `500000` = $1) and `formatDollars()`. Services and panels import from there; never `parseFloat(process.env.*_GRANT_DOLLARS)` in a service again.
- Money for display ALWAYS goes through `formatDollars()`. It keeps the cents pair ($0.50, not $0.5) and a third decimal only when it carries meaning ($0.025, not a rounded $0.03). A bare `toFixed(2)` silently misstates any sub-cent payout.
- new-api auth: requires BOTH `Authorization: <NEW_API_ADMIN_TOKEN>` AND `New-Api-User: <NEW_API_USER_ID>` headers. Token = admin user's access_token from new-api `users` table.
- Crash-guard in `main.ts` — `unhandledRejection` + `uncaughtException` only log, never exit.
- discordx classes look "unused" to knip — they're loaded via decorator side-effects in `src/bot/index.ts`. Ignore those flags.
- No barrel files when splitting modules. Move symbol, update all importers via `grep`/`rg`.

### Server tag reward

Pays per FULL DAY the guild's tag is worn, tracked as wear windows in `server_tag_wears`.
Duration-based on purpose: dropping the tag closes the window and discards its partial progress,
so toggling it can never manufacture time. A partial unique index on `(member_id, guild_id) WHERE
active` enforces one open window per member at the DB level.

- Detection is `user.primaryGuild` off `guildMemberUpdate` (fires on change; needs the
  `GuildMembers` intent). Gate on `identityEnabled === true` AND `identityGuildId === guildId` -
  Discord leaves a STALE `identity_guild_id` on people who used to wear a since-renamed tag, so
  matching the guild id alone pays non-wearers.
- `reconcile()` runs on boot and hourly to repair windows missed during downtime. It never
  backdates credit, and closes a stale window WITHOUT paying (we cannot know when the tag came
  off). This is why there is no tag backfill command and none is needed.
- Payouts are HELD, not skipped, when the recipient is unlinked or upstream refuses
  (`ipDuplicate`): `nextPayoutAt` is left alone so the day is retried, capped at
  `MAX_CATCHUP_PAYOUTS` per tick so a late link cannot burst hundreds of grant calls.
- **Discord has NO API for SETTING a user's tag** - it is a profile setting only the user's own
  client can change, and no OAuth scope exposes it. The verify-panel button can only report
  status; do not try to build an "apply the tag" button.

## Changing reward amounts (runbook)

Amounts live in OpenBao, NOT in code. The bot serves them at `GET /rewards` (cluster-internal,
port 4000, no public ingress) and the website docs fetch that endpoint hourly, so a cut needs
no site deploy and no translation edits.

```bash
# 1. patch OpenBao (kv v2 at mount `secret`, path `bot-env`). USE patch, NOT put:
#    put replaces the whole secret and would drop the other ~46 keys.
TOKEN=$(sops -d secrets/openbao-init.sops.yaml | grep -i root_token | awk '{print $2}')   # in infra repo
kubectl -n openbao exec openbao-0 -- sh -c "BAO_TOKEN='$TOKEN' bao kv patch secret/bot-env \
  CONNECT_GRANT_DOLLARS=0.50 VOTE_GRANT_DOLLARS=0.025 BOOST_GRANT_DOLLARS=0.50 \
  LEVEL_GRANT_DOLLARS=0.03,0.05,0.13,0.25,0.50,1,2.50,5,12.50"

# 2. ESO refresh is 1h; force it, then restart so the pod picks up new env
kubectl -n services annotate externalsecret bot-env force-sync=$(date +%s) --overwrite
kubectl -n services rollout restart deploy/unorouter-bot

# 3. verify what is ACTUALLY being paid
kubectl -n services exec deploy/unorouter-bot -- wget -qO- http://localhost:4000/rewards
```

Then re-run `/verify-panel` and `/vote-panel` in Discord (both read the amount at runtime;
`purgeOwnPanels` makes re-running idempotent). Docs follow within the hour.

Env vars: `CONNECT_GRANT_DOLLARS`, `VOTE_GRANT_DOLLARS`, `BOOST_GRANT_DOLLARS`,
`INVITE_GRANT_DOLLARS`, `SERVER_TAG_GRANT_DOLLARS`, `LEVEL_GRANT_DOLLARS` (comma list positional
to `LEVEL_ROLES`). Set a value to `0` to disable that reward entirely; the panels degrade to
"free balance" wording. Bug bounty has NO env var - staff type the amount per report.

### Gotchas learned the hard way

- **Deploy the bot BEFORE patching OpenBao** when the formatter changed, or the panels advertise
  a rounded figure while the bot pays the real one.
- **Non-bot surfaces do not auto-update.** The `❤️│boosters` post is authored by Don and states
  the boost amount in prose; a user token must PATCH it (`/api/v9/channels/<ch>/messages/<id>`).
  Grep the pinned posts in `📢 INFORMATION` for stale figures after every cut.
- **The bot DOES run migrations on boot** (a failure only logs "Database migration failed" and
  the bot keeps running, so it is easy to miss). Prefer letting it apply them: generate with
  drizzle-kit, commit, deploy. If you apply SQL BY HAND you must also
  (a) `ALTER TABLE <t> OWNER TO unorouter;` plus its `_id_seq`, and `ALTER TYPE <enum> OWNER TO
  unorouter;` - the app connects as `unorouter`, and objects created as `postgres` are either
  invisible to it or refuse `ALTER TYPE ... ADD VALUE` with "must be owner of type"; and
  (b) insert the migration's sha256 into `drizzle.__drizzle_migrations (hash, created_at)` using
  the `when` value from `drizzle/meta/_journal.json`, or the runner replays it on every boot and
  fails on the already-applied enum value.
- **A channel that denies `@everyone` SEND_MESSAGES needs a bot ROLE overwrite** (type 0, against
  the bot's guild role, e.g. `UnoRouter Bot`), not a member overwrite. Without it a panel command
  purges the old post and then fails to send, leaving the channel empty. Restart the bot after
  changing channel perms or discord.js keeps computing from its stale cache.

## Editing the Discord server itself (Browser MCP)

Most server-admin tasks (rename channel, delete channel, edit pinned panel posts, post announcements) are NOT bot code. They go through the Discord web client via `mcp__chrome-devtools__*` tools. Brave runs with remote-debugging on port 9223; the chrome-devtools MCP attaches there.

TWO ACCOUNTS, and the difference matters: **Brave (9223) is `Don`** (Admin role, authored the
pinned posts, so only Don's token can PATCH them). **Chrome (9224) is `mr.countdown`, the SERVER
OWNER** - it holds only the `Verified` role, so owner status is what grants it authority; use it
for anything role/permission related that Don cannot do. The MCP is attached to Brave only;
drive Chrome over raw CDP against its `webSocketDebuggerUrl`.

> **Shipping a release post?** See [RELEASE-POSTS.md](RELEASE-POSTS.md) for the end-to-end runbook: when to use changelog vs announcements vs blog, the post+publish+edit MCP scripts, and the full blog flow (registry + content + 18-locale translation fan-out).

### Get the user token (once per session)

Discord's webpack chunk push trick. Returns a 72-char user token (NOT a bot token):

```js
let token;
webpackChunkdiscord_app.push([
  [Math.random()],
  {},
  (req) => {
    for (const id in req.c) {
      const mod = req.c[id]?.exports;
      if (!mod) continue;
      for (const c of [mod, mod.default, mod.Z, mod.ZP]) {
        try {
          if (c?.getToken) {
            const v = c.getToken();
            if (typeof v === "string" && v.length > 20) token = v;
          }
        } catch {}
      }
    }
  },
]);
// `token` is now usable as Authorization header on /api/v9/*
```

### Common operations (PATCH/POST/DELETE /api/v9/\*)

All require the page to be `discord.com/channels/<guildId>/<channelId>` (or any logged-in Discord page) before the script runs.

**Find channel by name:**

```js
const r = await fetch(`/api/v9/guilds/${guildId}/channels`, {
  headers: { Authorization: token },
});
const arr = await r.json();
arr
  .filter((c) => /verify/i.test(c.name))
  .map((c) => ({ id: c.id, name: c.name, type: c.type }));
```

**Rename channel:**

```js
fetch(`/api/v9/channels/${channelId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify({ name: "✅│verify" }),
});
```

**Delete channel** (irreversible — confirm with user first):

```js
fetch(`/api/v9/channels/${channelId}`, {
  method: "DELETE",
  headers: { Authorization: token },
});
```

**Post a message:**

```js
fetch(`/api/v9/channels/${channelId}/messages`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify({ content: "..." }),
});
```

**Edit a message YOU AUTHORED** (user token can only PATCH your own messages, NOT the bot's):

```js
fetch(`/api/v9/channels/${channelId}/messages/${messageId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify({ content: "..." }),
});
```

To replace a bot-authored panel embed, re-run the bot's `/verify-panel` (or equivalent) command. `purgeOwnPanels` in [src/core/utils/command.utils.ts](src/core/utils/command.utils.ts) deletes the bot's previous post in the channel before reposting, so re-running the command is idempotent.

**Pin a message:**

```js
fetch(`/api/v9/channels/${channelId}/pins/${messageId}`, {
  method: "PUT",
  headers: { Authorization: token },
});
```

**List server's registered slash commands** (resolve `verify-panel` etc. to command id):

```js
fetch(`/api/v9/applications/${botAppId}/guilds/${guildId}/commands`, {
  headers: { Authorization: token },
});
```

### Research ANY server you have joined (guild message search)

Reading another community's own discussions (e.g. a proxy service's Discord to
learn their policy before pitching a partnership) uses the SAME user token. This
is your own account's token on your own logged-in session; it only reads what you
can already read in the UI, just without React's pagination limits.

DON'T trust `location.pathname.split('/')[2]` for the guild id: on the DMs view it
is `@me`, and the search then silently returns results from the wrong scope (this
burned a real investigation - results for another server were actually the UnoRouter guild
until the id was pinned). Resolve the target guild explicitly first:
`(await (await fetch('https://discord.com/api/v9/users/@me/guilds',{headers:{authorization:token}})).json()).filter(x=>/NAME/i.test(x.name))`,
then hardcode that guild id into the search loop.

Two token gotchas that produce a silent `401`:

- The webpack-chunk trick above sometimes returns nothing on non-owned servers.
  The reliable fallback is the iframe read (localStorage is same-origin but the
  main window's copy is often cleared by Discord): `const f =
  document.createElement("iframe"); document.body.append(f); const token =
  JSON.parse(f.contentWindow.localStorage.getItem("token")); f.remove();`
- Send the token as the `authorization` header value verbatim (the JSON-parsed
  string, no `Bearer` prefix, no extra quotes).

```js
const guildId = location.pathname.split("/")[2];
for (const q of ["whitelist", "cors", "403", "custom frontend"]) {
  let r = await fetch(
    `/api/v9/guilds/${guildId}/messages/search?content=${encodeURIComponent(q)}&limit=10`,
    { headers: { authorization: token } },
  );
  if (r.status === 429) {
    const j = await r.json();
    await new Promise((s) => setTimeout(s, (j.retry_after ?? 1) * 1000 + 500));
    r = await fetch(/* retry same url */);
  }
  const j = await r.json();
  // j.total_results = count; j.messages = array of [contextMsgs...]; the
  // matched message has `hit: true`. Truncate content, throttle ~700ms between
  // terms to stay under the search rate limit.
}
```

This found one service's allowlist policy: their staff whitelist a
frontend if you give them the Cloudflare Ray ID from your 403 (grab it with
`curl -D - ... | grep -i cf-ray`), and other custom frontends hit the identical
403-HTML-page symptom. Worth checking a service's own server for prior asks
before opening a partnership conversation.

### Trigger a bot slash command without typing

Discord guild-command sync can lag a few seconds after deploy. Instead of typing `/verify-panel` and pressing Tab+Enter, drive the textbox via `mcp__chrome-devtools__type_text` after focusing the message input (`role="textbox"`, classes include `slateTextArea_*`):

1. `click` the textbox uid
2. `press_key Control+a` then `Delete` to clear
3. `type_text "/verify-pa"` — wait for the listbox to surface `/verify-panel`
4. `press_key Tab` to insert the slash-command chip
5. `press_key Enter` to send

### Markdown that works in Discord messages

- `[text](url)` IS supported in regular messages (so URLs can be hidden). Earlier note that "plain messages don't render markdown links" was wrong.
- `<url>` brackets suppress link embed preview.
- Channel mentions: `<#1510752428440555704>` (no name required, channel resolves to its current name).
- Role mentions: `<@&roleId>`. User mentions: `<@userId>`.

### Where common channel IDs live

Don't hardcode. Each session, refetch via the `guilds/${guildId}/channels` endpoint above. The bot doesn't need IDs at all (NAME substring resolution).

## Cluster access (logs, env, DB) — k3s, not don

Kubeconfig lives at `infra/kubeconfig` (`export KUBECONFIG=.../infra/kubeconfig`).

Logs + env (bot runs in namespace `services`, deploy/pod `unorouter-bot`):

```bash
kubectl -n services logs deploy/unorouter-bot --tail 100 -f
kubectl -n services exec deploy/unorouter-bot -- env | grep -E 'NEW_API|BOT_NAME|DATABASE_URL'
```

Env is now plain pod env (k8s secret via OpenBao/ESO); there is NO `.env` file on disk and
no dotenvx wrapper in prod. `kubectl exec ... env` IS the source of truth.

Databases — two CloudNativePG clusters in namespace `databases`, reach via `kubectl exec`
into the primary pod (`-pg-1` = current primary; confirm with `kubectl get cluster -n
databases`). Bot DB is named `unorouter-bot-db`; new-api DB is `newapi`:

```bash
# bot DB
kubectl -n databases exec bot-pg-1 -c postgres -- \
  psql -U postgres -d unorouter-bot-db -c "SELECT count(*) FROM member;"
# new-api DB (the users table the bot grants against)
kubectl -n databases exec newapi-pg-1 -c postgres -- \
  psql -U postgres -d newapi -c "SELECT id, username, discord_id FROM users WHERE discord_id <> '' LIMIT 10;"
```

For an app-user connection instead of superuser, the `-rw` service (`bot-pg-rw` /
`newapi-pg-rw`) is the writable endpoint; creds are in OpenBao.

## Don'ts

- No `co-authored-by` / "Generated with Claude Code" / Claude refs in commits, PRs, issues.
- No ASCII-dash punctuation. No em/en dash, no Unicode arrows in source/commits.
- No tests unless explicitly requested.
- No bloated comments. Comment only non-obvious WHY, one terse line. No restating code.
- No barrel re-export files when splitting modules. Rewrite each importer.
- Don't manually deploy. GHCR image build + ArgoCD/kubectl rollout only (don is gone).
- Don't reset/regenerate new-api `SYSTEM_ACCESS_TOKEN` casually — every secret consumer (`NEW_API_ADMIN_TOKEN` here) breaks until re-set.

## Server channels (UnoRouter, guild 1498300365001588746)

Resolve by NAME substring, never hardcode IDs in code. IDs below are for fast
navigation only (`discord.com/channels/1498300365001588746/<id>`). Layout grouped
by category. The three pinned onboarding posts (information / announcements /
changelog) are all authored by Don and edited in-place; update them via Browser
MCP, not bot code.

### 📢 INFORMATION (read-only, staff-posted)

- **📌│information** `1509890163285950636` (Rules channel) — welcome + platform
  overview. "Unified API gateway, 70+ AI models (OpenAI, Anthropic, Google)."
  Links: dashboard (`/en/login`), docs (`/en/docs`), models (`/en/models`),
  Discord guidelines. Single pinned post.
- **📣│announcements** `1509891684282925216` (Announcement channel) — headline
  pitch ("One API key, 70+ models, single OpenAI-compatible endpoint"). Sections:
  Start here (models / pricing / docs / chat playground), Earn free balance
  (verify `$1` one-time, boost `$1`/boost, bug-bounty up to `$50`), Channels
  (help / feature-requests / model-requests / changelog).
- **📝│changelog** `1509906155043029202` (Announcement channel) — "Latest first.
  Major shipped changes only." Tracks bot + site releases (bot launch, verify
  panel, boost auto-grant, bug-bounty forum, ticket system, deep-link login,
  settings UI).
- **🚀│boosters** `1510368497887084555` — boost reward surface ($1/boost
  auto-grant).
- **✅│verify** `1510752428440555704` — Discord-link verify panel; claim `$1`
  one-time + linked role. Driven by `/verify-panel` + `claim_connect` interaction.

### 💬 COMMUNITY

- **💬│general** `1509888910732431490` — open chat.
- **🗳️│feature-requests** `1509888593949102170` — product requests.
- **🧠│model-requests** `1510746273135722507` — requests to add specific models.
- **🤖│bot-commands** `1509889754894700637` — bot command usage.

### 🛠️ SUPPORT

- **🎫│create-ticket** `1510366683070595192` — opens a private per-request ticket
  channel; staff grant balance from inside (`/ticket-panel`, `ticket_*`
  interactions).
- **🛡️│bug-bounty** `1510366688045170708` (Forum) — tiered rewards up to
  `$50`/finding (`bug_*` interactions, `reward_modal`).

### 📋 LOGS (staff/private)

- **🛡️│moderator-only** `1509890163827019859`
- **🌟│join-events** `1509907917803884554`
- **📄│ticket-logs** `1510366691454882014`
- **🎁│grants-log** `1510366694705594429` (grant.service announce target)

### 🔒 PRISON

- **🔒│jail** `1510366698749038706` — isolation channel for the role/jail logic
  in `core/services/roles/`.

### Partner servers (dedicated channel, server NOT ours)

- **The AI Bunker** (guild `1223037722998865940`) to **♠️unorouter**
  `1513243139064856697` — plain text channel we own on a friend's server. Carries
  the promo intro + mirrored changelog entries. We post as user "Don" via Browser
  MCP; no bot, no crosspost. See [RELEASE-POSTS.md](RELEASE-POSTS.md).