CREATE TABLE "level_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"tier" integer NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"rewarded" boolean DEFAULT false NOT NULL,
	"rewarded_quota" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"rewarded_at" timestamp(3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_level_rewards_member_tier" ON "level_rewards" USING btree ("member_id","guild_id","tier");