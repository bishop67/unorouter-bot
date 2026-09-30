CREATE TABLE "mod_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"moderator_id" text,
	"reason" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_mod_logs_guild_target" ON "mod_logs" USING btree ("guild_id","target_id");