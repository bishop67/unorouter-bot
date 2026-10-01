CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"username" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_watchlist_guild_member" ON "watchlist" USING btree ("guild_id","member_id");