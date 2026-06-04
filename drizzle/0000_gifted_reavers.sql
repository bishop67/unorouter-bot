CREATE TABLE "bug_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"forum_thread_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"rewarded_quota" integer DEFAULT 0 NOT NULL,
	"resolved_by" text,
	"pending_reward_quota" integer,
	"pending_reward_reason" text,
	"pending_reward_granted_by" text,
	"pending_reward_target_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolved_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "grant_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_discord_id" text NOT NULL,
	"new_api_user_id" integer,
	"quota" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"granted_by_discord_id" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"guild_name" text NOT NULL,
	"lookback" integer DEFAULT 9999 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"member_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"created_at" timestamp(3),
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"avatar_url" text,
	"banner_url" text,
	"bot" boolean DEFAULT false NOT NULL,
	"flags" bigint,
	"system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_guilds" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"nickname" text,
	"display_name" text,
	"warnings" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp(3),
	"premium_since" timestamp(3),
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"name" text,
	"color" integer,
	"hex_color" text,
	"position" integer,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"opener_id" text NOT NULL,
	"category" text DEFAULT 'support' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"pending_reward_quota" integer,
	"pending_reward_reason" text,
	"pending_reward_granted_by" text,
	"redeemed_at" timestamp(3),
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closed_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_tag" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_guilds" ADD CONSTRAINT "member_guilds_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_guilds" ADD CONSTRAINT "member_guilds_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bug_reports_forum_thread" ON "bug_reports" USING btree ("forum_thread_id");--> statement-breakpoint
CREATE INDEX "idx_grant_logs_target" ON "grant_logs" USING btree ("target_discord_id");--> statement-breakpoint
CREATE INDEX "idx_grant_logs_source" ON "grant_logs" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_guilds_member_guild" ON "member_guilds" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_messages_message" ON "member_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_member_messages_member_guild" ON "member_messages" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_member_roles_member_guild" ON "member_roles" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_roles_member_role" ON "member_roles" USING btree ("member_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tickets_channel" ON "tickets" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_opener_status" ON "tickets" USING btree ("opener_id","status");--> statement-breakpoint
CREATE INDEX "idx_ticket_messages_ticket" ON "ticket_messages" USING btree ("ticket_id");