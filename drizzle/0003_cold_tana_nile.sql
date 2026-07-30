ALTER TYPE "public"."reward_source" ADD VALUE 'servertag';--> statement-breakpoint
CREATE TABLE "server_tag_wears" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"next_payout_at" timestamp(3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cancelled_at" timestamp(3)
);
--> statement-breakpoint
ALTER TABLE "server_tag_wears" ADD CONSTRAINT "server_tag_wears_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "server_tag_wears" ADD CONSTRAINT "server_tag_wears_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_server_tag_wears_active" ON "server_tag_wears" USING btree ("member_id","guild_id") WHERE "server_tag_wears"."active";--> statement-breakpoint
CREATE INDEX "idx_server_tag_wears_due" ON "server_tag_wears" USING btree ("active","next_payout_at");