CREATE TABLE "recent_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_recent_messages_guild_author" ON "recent_messages" USING btree ("guild_id","author_id");--> statement-breakpoint
CREATE INDEX "idx_recent_messages_created" ON "recent_messages" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "recent_messages" ("message_id", "guild_id", "channel_id", "author_id", "created_at")
SELECT "message_id", "guild_id", "channel_id", "member_id", "created_at" FROM "member_messages"
WHERE "created_at" > CURRENT_TIMESTAMP - INTERVAL '14 days'
ON CONFLICT DO NOTHING;
