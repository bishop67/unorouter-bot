CREATE TABLE "invite_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invite_joins_guild_invitee" ON "invite_joins" USING btree ("guild_id","invitee_id");--> statement-breakpoint
CREATE INDEX "idx_invite_joins_inviter_guild" ON "invite_joins" USING btree ("inviter_id","guild_id");