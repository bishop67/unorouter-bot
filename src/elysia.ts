import { voteRoutes } from "@/api/routes/vote.routes";
import { logger } from "@/lib/logger";
import { node } from "@elysiajs/node";
import { Elysia } from "elysia";

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "4000", 10);

// HTTP surface for inbound listing-site vote webhooks. Started from main.ts
// after the Discord client logs in so grant announces have a ready guild.
export function startWebhookServer(): void {
  new Elysia({ adapter: node() })
    .onError(({ error, path, code }) => {
      if (code === "NOT_FOUND") return;
      logger.error("Webhook server error", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .get("/health", () => ({ ok: true }))
    .use(voteRoutes)
    .listen(WEBHOOK_PORT, () =>
      logger.info("Webhook server started", { port: WEBHOOK_PORT }),
    );
}
