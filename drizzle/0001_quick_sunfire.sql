CREATE TABLE "vote_role_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"site" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vote_role_holds_member_site" ON "vote_role_holds" USING btree ("member_id","site");