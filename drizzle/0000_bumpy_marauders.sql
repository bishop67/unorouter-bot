CREATE TYPE "public"."bug_status" AS ENUM('open', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('pending', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."reward_source" AS ENUM('command', 'ticket', 'bug', 'boost', 'connect', 'vote', 'invite', 'level');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('support', 'bug');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."vote_site" AS ENUM('topgg', 'discords', 'discadia', 'discordservers');--> statement-breakpoint
CREATE TABLE "boost_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"source_message_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"next_payout_at" timestamp(3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cancelled_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"forum_thread_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"status" "bug_status" DEFAULT 'open' NOT NULL,
	"rewarded_quota" integer DEFAULT 0 NOT NULL,
	"resolved_by" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolved_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dm_optouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"source" "reward_source" NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"guild_name" text NOT NULL,
	"lookback" integer DEFAULT 9999 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_seeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"uses" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
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
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" "reward_source" NOT NULL,
	"guild_id" text NOT NULL,
	"target_member_id" text NOT NULL,
	"ref_id" text,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"pending_quota" integer,
	"pending_reason" text,
	"granted_by_member_id" text,
	"earned_units" integer,
	"rewarded_quota" integer DEFAULT 0 NOT NULL,
	"rewarded_at" timestamp(3),
	"grant_id" integer,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_member_id" text NOT NULL,
	"guild_id" text,
	"new_api_user_id" integer,
	"quota" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" "reward_source" NOT NULL,
	"source_id" text,
	"granted_by_member_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"role_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text,
	"color" integer,
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
	"category" "ticket_category" DEFAULT 'support' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closed_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" text,
	"content" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_role_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"site" "vote_site" NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boost_slots" ADD CONSTRAINT "boost_slots_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "boost_slots" ADD CONSTRAINT "boost_slots_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_id_members_member_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "dm_optouts" ADD CONSTRAINT "dm_optouts_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invite_joins" ADD CONSTRAINT "invite_joins_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invite_joins" ADD CONSTRAINT "invite_joins_invitee_id_members_member_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invite_seeds" ADD CONSTRAINT "invite_seeds_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_guilds" ADD CONSTRAINT "member_guilds_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_guilds" ADD CONSTRAINT "member_guilds_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_messages" ADD CONSTRAINT "member_messages_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_target_member_id_members_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_granted_by_member_id_members_member_id_fk" FOREIGN KEY ("granted_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_grant_id_reward_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."reward_grants"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_target_member_id_members_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_granted_by_member_id_members_member_id_fk" FOREIGN KEY ("granted_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_channel_id_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("channel_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opener_id_members_member_id_fk" FOREIGN KEY ("opener_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_members_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vote_role_holds" ADD CONSTRAINT "vote_role_holds_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_boost_slots_member_guild" ON "boost_slots" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_boost_slots_due" ON "boost_slots" USING btree ("active","next_payout_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bug_reports_forum_thread" ON "bug_reports" USING btree ("forum_thread_id");--> statement-breakpoint
CREATE INDEX "idx_channels_guild" ON "channels" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dm_optouts_member_source" ON "dm_optouts" USING btree ("member_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invite_joins_guild_invitee" ON "invite_joins" USING btree ("guild_id","invitee_id");--> statement-breakpoint
CREATE INDEX "idx_invite_joins_inviter_guild" ON "invite_joins" USING btree ("inviter_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invite_seeds_guild_inviter" ON "invite_seeds" USING btree ("guild_id","inviter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_guilds_member_guild" ON "member_guilds" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_messages_message" ON "member_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_member_messages_member_guild" ON "member_messages" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_member_roles_member_guild" ON "member_roles" USING btree ("member_id","guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_roles_member_role" ON "member_roles" USING btree ("member_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reward_claims_source_guild_target_ref" ON "reward_claims" USING btree ("source_type","guild_id","target_member_id","ref_id");--> statement-breakpoint
CREATE INDEX "idx_reward_claims_status" ON "reward_claims" USING btree ("status","source_type");--> statement-breakpoint
CREATE INDEX "idx_reward_grants_target" ON "reward_grants" USING btree ("target_member_id");--> statement-breakpoint
CREATE INDEX "idx_reward_grants_dedupe" ON "reward_grants" USING btree ("target_member_id","source_type","source_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_roles_guild" ON "roles" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tickets_channel" ON "tickets" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_opener_status" ON "tickets" USING btree ("opener_id","status");--> statement-breakpoint
CREATE INDEX "idx_ticket_messages_ticket" ON "ticket_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vote_role_holds_member_site" ON "vote_role_holds" USING btree ("member_id","site");