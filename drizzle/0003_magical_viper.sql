CREATE TABLE "invite_seeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"uses" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invite_seeds_guild_inviter" ON "invite_seeds" USING btree ("guild_id","inviter_id");