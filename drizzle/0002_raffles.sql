CREATE TABLE "giveaway_raffles" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"prize" text NOT NULL,
	"code" text,
	"verified_only" boolean DEFAULT false NOT NULL,
	"created_by_member_id" text,
	"ends_at" timestamp(3) NOT NULL,
	"ended_at" timestamp(3),
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_raffle_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"raffle_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaway_raffle_winners" (
	"id" serial PRIMARY KEY NOT NULL,
	"raffle_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"code" text,
	"dm_sent" boolean DEFAULT false NOT NULL,
	"rerolled_from" integer,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "giveaway_raffles" ADD CONSTRAINT "giveaway_raffles_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_raffles" ADD CONSTRAINT "giveaway_raffles_created_by_member_id_members_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_raffle_entries" ADD CONSTRAINT "giveaway_raffle_entries_raffle_id_giveaway_raffles_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."giveaway_raffles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_raffle_entries" ADD CONSTRAINT "giveaway_raffle_entries_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_raffle_winners" ADD CONSTRAINT "giveaway_raffle_winners_raffle_id_giveaway_raffles_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."giveaway_raffles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "giveaway_raffle_winners" ADD CONSTRAINT "giveaway_raffle_winners_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_giveaway_raffles_guild_ended" ON "giveaway_raffles" USING btree ("guild_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_giveaway_raffle_entries_raffle_member" ON "giveaway_raffle_entries" USING btree ("raffle_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_giveaway_raffle_entries_raffle" ON "giveaway_raffle_entries" USING btree ("raffle_id");--> statement-breakpoint
CREATE INDEX "idx_giveaway_raffle_winners_raffle" ON "giveaway_raffle_winners" USING btree ("raffle_id");