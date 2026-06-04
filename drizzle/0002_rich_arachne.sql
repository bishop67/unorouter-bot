ALTER TABLE "bug_reports" ADD COLUMN "pending_reward_quota" integer;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD COLUMN "pending_reward_reason" text;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD COLUMN "pending_reward_granted_by" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_reward_quota" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_reward_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_reward_granted_by" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "redeemed_at" timestamp(3);