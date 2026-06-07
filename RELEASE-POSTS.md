# Release posts runbook (Discord + blog)

End-to-end process for announcing a shipped change across the UnoRouter Discord
and the unorouter.ai blog. Two independent surfaces; pick what the change earns.

Repos:

- **Discord posts**: this repo's Browser-MCP flow (see CLAUDE.md "Editing the
  Discord server itself"). Posts go through the logged-in Discord web client via
  `mcp__chrome-devtools__*` against Brave on port 9223. NOT bot code.
- **Blog**: `/home/zero/MEGA/Projects/ai-api/unorouter` (Next.js). Registry +
  content component + 18 locale files. Ships via that repo's CI.

## Step 0: decide the surface (depends on the change)

The bigger and more user-facing the change, the more surfaces it earns. Match the
text length and tone to the surface.

| Change size | changelog | announcements | blog |
| --- | --- | --- | --- |
| Minor / internal (UI tweak, perf, small fix) | yes | no | no |
| Notable feature (new panel, new reward) | yes | maybe | no |
| Major feature / launch / large catalog change | yes | yes | yes |

Rules of thumb:

- **changelog** is the always-on log. Terse, dated, latest-first. Almost every
  shipped change goes here.
- **announcements** is a push (crossposted to followers). Reserve for things a
  user would want a notification about. Fuller copy, sectioned, links + CTA.
- **blog** is for stories worth SEO + depth: launches, benchmarks, big catalog
  expansions, engineering write-ups. ~400-700 words, 5-6 sections, 18 locales.

If unsure: changelog only. You can always promote later by also posting to
announcements and writing a blog.

## Channel IDs (guild 1498300365001588746)

| Channel | ID | Type |
| --- | --- | --- |
| 📝│changelog | `1509906155043029202` | Announcement (publishable) |
| 📣│announcements | `1509891684282925216` | Announcement (publishable) |

Announcement channels support **crosspost** (publish) which fans the message out
to every server that follows the channel. Always publish after posting.

## Part A: Discord post (Browser MCP)

Prereq: a Discord tab open in Brave (port 9223). The MCP attaches there; the
logged-in session (user "Don") authors the post. Confirm with
`curl -s http://127.0.0.1:9223/json/version`.

### A1. Write the copy

- **changelog** voice: `## <Mon D, YYYY>` header, then `**Bold change**` + one
  terse detail line per change. Latest-first. Lead the most important line.
- **announcements** voice: `# Headline`, then `### Section` blocks, a caveat
  section when relevant, and a closing link. Suppress link embeds with `<url>`.
- Honesty rule (house style): if a feature has a real limitation (rate limits,
  best-effort, caveats), state it UP FRONT in its own bold block, not buried.
- Discord markdown that works: `## H2`, `### H3`, `**bold**`, `` `code` ``,
  `[text](url)`, `<url>` (no embed), channel mentions `<#channelId>`.
- ASCII punctuation only (house rule). No em/en dashes, no Unicode arrows.

### A2. Post + publish in one MCP call

Use `mcp__chrome-devtools__evaluate_script` on the open Discord tab. The script
grabs the user token via the webpack trick (CLAUDE.md "Get the user token"),
POSTs the message, then crossposts it.

```js
async () => {
  let token;
  webpackChunkdiscord_app.push([[Math.random()], {}, (req) => {
    for (const id in req.c) {
      const mod = req.c[id]?.exports; if (!mod) continue;
      for (const c of [mod, mod.default, mod.Z, mod.ZP]) {
        try { if (c?.getToken) { const v = c.getToken(); if (typeof v === "string" && v.length > 20) token = v; } } catch {}
      }
    }
  }]);
  if (!token) return { ok: false, error: "no token" };

  const channelId = "1509906155043029202"; // changelog (or announcements id)
  const content = [
    "## Mon D, YYYY",
    "**Headline change**",
    "Terse detail line.",
  ].join("\n");

  const res = await fetch(`/api/v9/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ content }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, err: j };

  // publish (announcement channels only)
  const cp = await fetch(`/api/v9/channels/${channelId}/messages/${j.id}/crosspost`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: token }, body: "{}",
  });
  return { ok: true, id: j.id, published: cp.ok };
}
```

Returns the message id. Keep it: edits need it.

### A3. Edit later (trim bloat, fix typos)

PATCH the same message id. The user token can PATCH only messages it authored.

```js
await fetch(`/api/v9/channels/${channelId}/messages/${messageId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify({ content: newContent }),
});
```

Edits apply to the already-published copy too; no re-publish needed.

### A4. Verify

The POST response already confirms success (`ok: true`, message id, channel id).
A visual reload is optional. Do NOT assume failure just because the active MCP
tab is on a different channel; trust the API response.

## Part B: Blog post (unorouter repo)

Working dir: `/home/zero/MEGA/Projects/ai-api/unorouter`. Five edits + a
translation fan-out. Reference implementation: the `free-models-aggregated` post
(commit it ships in) touches exactly these files.

### B1. Decide metadata

- `slug`: kebab-case, stable forever (URL + i18n key derive from it).
- `date`: `YYYY-MM-DD`, the ship date.
- `category`: one of `launch | engineering | product | update` (drives theme
  color). `src/lib/types/seo.ts`.
- `tags`: free array, e.g. `["announcement", "product"]`.
- headings: 4-6 H2 sections, each `{ id, i18nLeaf: "H_<NAME>", level: 2 }`.

### B2. Content component

`src/components/pages/blog/posts/<date>-<slug>-content.tsx`. Async server
component. One `<p>` per section keyed to an i18n leaf. Use `t.rich(...)` for any
paragraph with inline tags or links. Standard tag handlers:

- `c: (chunks) => <code>{chunks}</code>` for inline code
- `s: (chunks) => <strong>{chunks}</strong>` for emphasis
- `register: (chunks) => <Link href="/register">{chunks}</Link>`
- `models: (chunks) => <Link href="/models">{chunks}</Link>`

Pass `APP_VALUES` to every `t()`/`t.rich()` so `{appName}`/`{appDomain}` resolve.
Export a named `PascalCaseContent` function.

### B3. Wire into posts.ts

`src/components/pages/blog/posts.ts`:

1. `import { <Name>Content } from "@/components/pages/blog/posts/<file>";`
2. add `"<slug>": <Name>Content,` to the `COMPONENTS` map.

### B4. Registry entry

`src/i18n/registry.ts`, in `BLOG_REGISTRY`, NEWEST FIRST (top of array). Match
the shape of an existing entry: `slug`, `date`, `tags`, `i18nKey`
(`BLOG.POSTS.<UPPER_SNAKE>`), `contentFiles`, `priority: 0.7`, `changeFrequency:
"monthly"`, `category`, `wordCount`, optional `heroImage`, `headings`. Search /
sitemap / llms.txt / seo-timestamps all enumerate this list, so no other edits.

### B5. English copy (en.json)

`public/i18n/en.json`, under `.BLOG.POSTS.<UPPER_SNAKE>`. Keys: `TITLE`,
`DESCRIPTION`, `AUTHOR` (`"{appName} team"`), `INTRO`, then per section a
`H_<NAME>` + `P_<NAME>`, and `CTA`. Use the same inline tags the component
expects (`<s> <c> <register> <models>`). Merge with jq to avoid hand-editing the
big file:

```bash
jq --slurpfile add /tmp/block-en.json \
  '.BLOG.POSTS.<UPPER_SNAKE> = $add[0]' public/i18n/en.json > /tmp/en.new \
  && mv /tmp/en.new public/i18n/en.json
```

### B6. Translate to the other 17 locales (Workflow fan-out)

House rule: every locale file gets REAL native translations, no English
placeholders; Chinese uses full-width punctuation. 17 locales: `ar de es fr he hi
id it ja ko pl pt-BR ru tr vi zh-CN zh-TW`.

Run a Workflow with one agent per locale (the `translate-blog-free-models`
script is the template; edit its `EN` object + key list and re-run). Each agent
returns a schema-validated JSON object. Prompt MUST instruct:

- return every key, translated values only
- preserve placeholders verbatim: `{appName}`, all numbers, all provider/model
  names, all technical terms
- preserve inline tags exactly (`<s> <c> <register> <models>`), translate only
  the text inside them
- RTL languages (`ar`, `he`): natural RTL, no direction marks
- Chinese (`zh-CN`, `zh-TW`): full-width punctuation; code/tags/numbers ASCII

Then merge each returned block into its file (mirror the en.json jq merge, one
per locale).

### B7. Validate everything

```bash
cd /home/zero/MEGA/Projects/ai-api/unorouter
# all 18 JSON valid + block present
for f in public/i18n/*.json; do jq -e '.BLOG.POSTS.<UPPER_SNAKE>.TITLE' "$f" >/dev/null || echo "BAD $f"; done
# tag integrity per locale (every <s></s> <c></c> <register></register> <models></models> present)
# chinese full-width punctuation (no [hanzi][,.:;])
# {appName} placeholder survived
bunx tsc --noEmit          # types
bunx eslint <touched .tsx + posts.ts>
```

All green = done. The prebuild (search index, seo-timestamps, sitemap) picks the
post up automatically on the next `bun build`.

### B8. Ship

Blog repo deploys via CI (its CLAUDE.md: commit, push, let GitHub Actions build).
Never ship build artifacts by hand. Commit the 4 code files + 18 locale files
together; the registry + content + en + 17 locales must land in one commit so the
build is never half-translated.

## Full sequence for a major release

1. Ship the underlying change first (the actual feature/sync), verify live.
2. Decide surfaces (Step 0). Major = all three.
3. Write blog (Part B), validate, commit + push the unorouter repo, wait for CI.
4. Once the blog is live, post Discord (Part A): changelog entry, then the
   announcement (link the blog post URL). Publish both.
5. Trim Discord copy if it reads bloated; PATCH in place (A3).

Order matters: blog first so the announcement can link a live post.
