import { voteRoutes } from "@/api/routes/vote.routes";
import { logger } from "@/lib/logger";
import { node } from "@elysiajs/node";
import { Elysia } from "elysia";

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "4000", 10);

// HTTP surface for inbound listing-site vote webhooks. Started from main.ts
// after the Discord client logs in so grant announces have a ready guild.
export function startWebhookServer(): void {
  new Elysia({ adapter: node() })
    .onError(({ error, path, code, set }) => {
      if (code === "NOT_FOUND") return;
      // status() throws are control flow, not failures - let Elysia render them.
      if (code === "INVALID_COOKIE_SIGNATURE") return;
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? JSON.stringify(error)
            : String(error);
      logger.error("Webhook server error", { path, code, status: set.status, error: msg });
    })
    .get("/health", () => ({ ok: true }))
    .use(voteRoutes)
    .listen(WEBHOOK_PORT, () =>
      logger.info("Webhook server started", { port: WEBHOOK_PORT }),
    );
}
