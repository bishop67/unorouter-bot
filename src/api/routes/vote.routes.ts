import { VoteService } from "@/core/services/vote/vote.service";
import { logger } from "@/lib/logger";
import { VoteSite } from "@/types";
import { Elysia, status, t } from "elysia";

// Each site sends the secret you set in its dashboard as a raw Authorization
// header (no "Bearer" prefix). Compare against the per-site env secret. A site
// with no secret configured rejects all its webhooks (fail closed). 4xx tells
// the sender not to retry, which is what we want on a bad secret.
function authorize(secret: string | undefined, header: string | undefined): boolean {
  if (!secret) return false;
  return header === secret;
}

// Top.gg has two payload generations:
//   v1 (current): { type: "vote.create" | "webhook.test", data: { user: { platform_id }, project: { platform_id } } }
//   v0 (legacy):  { type: "upvote" | "test", user, guild }
// Pull the voter's Discord id from whichever shape arrived.
function topggVoter(body: TopggBody): { test: boolean; userId: string | null } {
  if (body.type === "test" || body.type === "webhook.test") {
    return { test: true, userId: null };
  }
  const userId = body.data?.user?.platform_id ?? body.user ?? null;
  return { test: false, userId };
}

type TopggBody = {
  type?: string;
  user?: string;
  guild?: string;
  data?: { user?: { platform_id?: string } };
};

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
      if (!authorize(process.env.TOPGG_WEBHOOK_SECRET, headers.authorization)) {
        throw status("Unauthorized", "Invalid webhook secret");
      }
      const voter = topggVoter(body);
      if (voter.test) return { ok: true, test: true };
      if (!voter.userId) {
        logger.warn("Top.gg vote webhook missing voter id", { body });
        return { ok: true };
      }
      rewardAsync(voter.userId, VoteSite.TopGg);
      return { ok: true };
    },
    {
      // Loose: Top.gg v1 nests fields under data; only the shape we read is typed.
      body: t.Object(
        {
          type: t.Optional(t.String()),
          user: t.Optional(t.String()),
          guild: t.Optional(t.String()),
          data: t.Optional(
            t.Object(
              { user: t.Optional(t.Object({ platform_id: t.Optional(t.String()) }, { additionalProperties: true })) },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    },
  )
  // Discords.com server vote: { user, server, type, query }
  .post(
    "/discords",
    ({ headers, body }) => {
      if (!authorize(process.env.DISCORDS_WEBHOOK_SECRET, headers.authorization)) {
        throw status("Unauthorized", "Invalid webhook secret");
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
