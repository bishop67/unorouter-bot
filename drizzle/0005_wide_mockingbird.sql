CREATE TABLE "dm_optouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dm_optouts_member_source" ON "dm_optouts" USING btree ("member_id","source");