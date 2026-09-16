ALTER TABLE "member_guilds" ADD COLUMN "legacy_rewards" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every member present at the reward cut keeps the pre-cut vote rate; later joins default false.
UPDATE "member_guilds" SET "legacy_rewards" = true;
