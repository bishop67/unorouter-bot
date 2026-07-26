CREATE TYPE "public"."reward_refusal_reason" AS ENUM('ip_duplicate', 'not_linked');--> statement-breakpoint
CREATE TABLE "reward_refusals" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_member_id" text NOT NULL,
	"new_api_user_id" integer,
	"quota" integer NOT NULL,
	"source_type" "reward_source" NOT NULL,
	"source_id" text,
	"reason" "reward_refusal_reason" NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reward_refusals" ADD CONSTRAINT "reward_refusals_target_member_id_members_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_reward_refusals_target" ON "reward_refusals" USING btree ("target_member_id");--> statement-breakpoint
CREATE INDEX "idx_reward_refusals_reason" ON "reward_refusals" USING btree ("reason","created_at");