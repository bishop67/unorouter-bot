CREATE TYPE "public"."expression_kind" AS ENUM('emoji', 'sticker');--> statement-breakpoint
CREATE TABLE "expression_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"expression_id" text NOT NULL,
	"kind" "expression_kind" NOT NULL,
	"name" text NOT NULL,
	"message_uses" integer DEFAULT 0 NOT NULL,
	"reaction_uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp(3),
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expression_usage" ADD CONSTRAINT "expression_usage_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_expression_usage" ON "expression_usage" USING btree ("guild_id","expression_id");--> statement-breakpoint
CREATE INDEX "idx_expression_usage_last" ON "expression_usage" USING btree ("guild_id","last_used_at");