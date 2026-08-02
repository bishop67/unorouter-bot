CREATE TYPE "public"."giveaway_winner_kind" AS ENUM('ranked', 'random');--> statement-breakpoint
ALTER TYPE "public"."reward_source" ADD VALUE 'giveaway';--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"score" integer NOT NULL,
	"breakdown" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"started_by_member_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ended_at" timestamp(3),
	"prize_pool" text NOT NULL,
	"announce_message_id" text
);
--> statement-breakpoint
CREATE TABLE "giveaway_winners" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"place" integer NOT NULL,
	"kind" "giveaway_winner_kind" NOT NULL,
	"score" integer NOT NULL,
	"quota" integer NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_messages" ADD COLUMN "content_length" integer;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_round_id_giveaway_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."giveaway_rounds"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_rounds" ADD CONSTRAINT "giveaway_rounds_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_rounds" ADD CONSTRAINT "giveaway_rounds_started_by_member_id_members_member_id_fk" FOREIGN KEY ("started_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_winners" ADD CONSTRAINT "giveaway_winners_round_id_giveaway_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."giveaway_rounds"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_winners" ADD CONSTRAINT "giveaway_winners_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_giveaway_entries_round_member" ON "giveaway_entries" USING btree ("round_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_giveaway_entries_round_score" ON "giveaway_entries" USING btree ("round_id","score");--> statement-breakpoint
CREATE INDEX "idx_giveaway_entries_member" ON "giveaway_entries" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_giveaway_rounds_open" ON "giveaway_rounds" USING btree ("guild_id") WHERE "giveaway_rounds"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_giveaway_rounds_guild" ON "giveaway_rounds" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_giveaway_winners_round_member" ON "giveaway_winners" USING btree ("round_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_giveaway_winners_round" ON "giveaway_winners" USING btree ("round_id","place");--> statement-breakpoint
CREATE INDEX "idx_member_messages_created" ON "member_messages" USING btree ("created_at");