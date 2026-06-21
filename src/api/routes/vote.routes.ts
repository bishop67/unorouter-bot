import { VoteService } from "@/core/services/vote/vote.service";
import { logger } from "@/lib/logger";
import { VoteSite } from "@/types";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Elysia, status, t } from "elysia";

// Discords.com sends the secret you set in its dashboard as a raw Authorization
// header. Plain constant-time compare; no secret configured rejects all (fail closed).
function authorize(secret: string | undefined, header: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Top.gg v1 signs webhooks Stripe-style. Header:
//   x-topgg-signature: t=<unix>,v1=<hmac-sha256 hex of `${t}.${rawBody}`>
// Key is the whs_ secret created on the dashboard. Verify against the RAW body
// (a re-stringified object would differ and fail), reject on >5min skew (replay).
function verifyTopggSignature(rawBody: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;

  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

type TopggBody = {
  type?: string;
  user?: string;
  guild?: string;
  data?: { user?: { platform_id?: string } };
};

// Pull the voter's Discord id from v1 (data.user.platform_id) or v0 flat (user).
function topggVoter(body: TopggBody): { test: boolean; userId: string | null } {
  if (body.type === "test" || body.type === "webhook.test") {
    return { test: true, userId: null };
  }
  return { test: false, userId: body.data?.user?.platform_id ?? body.user ?? null };
}

// Grant runs detached so the HTTP response returns inside Top.gg's 5s window;
// a slow grant would otherwise time out and trigger a retry (double-fire).
function rewardAsync(userId: string, site: VoteSite): void {
  void VoteService.reward(userId, site).catch((e) =>
    logger.error("Vote reward threw", { site, error: String(e) }),
  );
}

export const voteRoutes = new Elysia({ prefix: "/webhook" })
  .post(
    "/topgg",
    ({ headers, body }) => {
      const raw = typeof body === "string" ? body : "";
      if (!verifyTopggSignature(raw, headers["x-topgg-signature"], process.env.TOPGG_WEBHOOK_SECRET)) {
        return status("Unauthorized", "Invalid signature");
      }
      let parsed: TopggBody;
      try {
        parsed = JSON.parse(raw) as TopggBody;
      } catch {
        return status("Bad Request", "Invalid JSON");
      }
      const voter = topggVoter(parsed);
      if (voter.test) return { ok: true, test: true };
      if (!voter.userId) {
        logger.warn("Top.gg vote webhook missing voter id", { type: parsed.type });
        return { ok: true };
      }
      rewardAsync(voter.userId, VoteSite.TopGg);
      return { ok: true };
    },
    {
      // Capture the raw body as a string so the HMAC matches Top.gg byte-for-byte.
      // A parsed-then-restringified object would differ and fail verification.
      parse: async ({ request }) => await request.text(),
    },
  )
  // Discords.com server vote: { user, server, type, query }
  .post(
    "/discords",
    ({ headers, body }) => {
      if (!authorize(process.env.DISCORDS_WEBHOOK_SECRET, headers.authorization)) {
        return status("Unauthorized", "Invalid webhook secret");
      }
      rewardAsync(body.user, VoteSite.Discords);
      return { ok: true };
    },
    {
      body: t.Object(
        {
          user: t.String(),
          type: t.Optional(t.String()),
          server: t.Optional(t.String()),
          query: t.Optional(t.Unknown()),
          engine: t.Optional(t.String()),
        },
        { additionalProperties: true },
      ),
    },
  );
