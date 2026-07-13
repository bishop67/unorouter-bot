-- One-time data migration from the OLD schema (loaded into schema `staging`)
-- into the NEW normalized schema (public). Run AFTER 0000 creates the new tables.
-- Idempotent-ish: uses ON CONFLICT DO NOTHING so a re-run is safe.
--
-- Order respects FKs: guilds/members first, then entities (roles/channels),
-- then associations + domain rows, then the reward ledger.

BEGIN;

-- 1. Guilds + members (identity roots).
INSERT INTO public.guilds (guild_id, guild_name, lookback)
SELECT guild_id, guild_name, lookback FROM staging.guilds
ON CONFLICT (guild_id) DO NOTHING;

INSERT INTO public.members
  (member_id, username, global_name, created_at, updated_at, avatar_url, banner_url, bot, flags, system)
SELECT member_id, username, global_name, created_at, updated_at, avatar_url, banner_url, bot, flags, system
FROM staging.members
ON CONFLICT (member_id) DO NOTHING;

-- 1b. Stub members for every id referenced by reward/ticket/bug/boost rows that
-- is not already a member (satisfies the new FKs). username = the id as a
-- placeholder; real profile fills in on next Discord event.
INSERT INTO public.members (member_id, username)
SELECT DISTINCT ref, ref FROM (
  SELECT target_discord_id AS ref FROM staging.grant_logs
  UNION SELECT opener_id FROM staging.tickets
  UNION SELECT reporter_id FROM staging.bug_reports
  UNION SELECT member_id FROM staging.boost_slots
  UNION SELECT member_id FROM staging.vote_role_holds
  UNION SELECT invitee_id FROM staging.invite_joins
  UNION SELECT author_id FROM staging.ticket_messages WHERE author_id IS NOT NULL
) refs
WHERE ref IS NOT NULL AND ref <> 'system'
ON CONFLICT (member_id) DO NOTHING;

-- 2. Role entities extracted from member_roles (role_id -> name/color/position).
-- Pick one representative row per role_id (attributes are identical per role).
INSERT INTO public.roles (role_id, guild_id, name, color, position)
SELECT DISTINCT ON (role_id) role_id, guild_id, name, color, position
FROM staging.member_roles
ORDER BY role_id, id
ON CONFLICT (role_id) DO NOTHING;

-- 3. Channel entities extracted from member_messages + tickets.
INSERT INTO public.channels (channel_id, guild_id)
SELECT DISTINCT channel_id, guild_id FROM staging.member_messages
ON CONFLICT (channel_id) DO NOTHING;
INSERT INTO public.channels (channel_id, guild_id)
SELECT DISTINCT channel_id, guild_id FROM staging.tickets
ON CONFLICT (channel_id) DO NOTHING;

-- 4. member_guilds (drop derivable display_name).
INSERT INTO public.member_guilds
  (id, member_id, guild_id, status, nickname, warnings, joined_at, premium_since, updated_at)
SELECT id, member_id, guild_id, status, nickname, warnings, joined_at, premium_since, updated_at
FROM staging.member_guilds
ON CONFLICT DO NOTHING;

-- 5. member_roles as pure association (drop name/color/hexColor/position).
INSERT INTO public.member_roles (id, role_id, guild_id, member_id, created_at, updated_at)
SELECT id, role_id, guild_id, member_id, created_at, updated_at
FROM staging.member_roles
ON CONFLICT DO NOTHING;

-- 6. member_messages (channel_id now FK; channels seeded above).
INSERT INTO public.member_messages (id, member_id, guild_id, message_id, channel_id, created_at)
SELECT id, member_id, guild_id, message_id, channel_id, created_at
FROM staging.member_messages
ON CONFLICT (id) DO NOTHING;

-- 7. tickets (enum status/category; drop pending_reward* + redeemed_at).
INSERT INTO public.tickets (id, guild_id, channel_id, opener_id, category, status, created_at, closed_at)
SELECT id, guild_id, channel_id, opener_id,
       category::public.ticket_category, status::public.ticket_status,
       created_at, closed_at
FROM staging.tickets
ON CONFLICT (id) DO NOTHING;

-- 8. ticket_messages (author_tag -> author_id; author_tag is "name#disc" or a
-- username in old rows, not an id, so author_id is left NULL for legacy rows).
INSERT INTO public.ticket_messages (id, ticket_id, author_id, content, created_at)
SELECT id, ticket_id, NULL, content, created_at
FROM staging.ticket_messages
ON CONFLICT (id) DO NOTHING;

-- 9. bug_reports (enum status; drop pending_reward*).
INSERT INTO public.bug_reports
  (id, guild_id, forum_thread_id, reporter_id, status, rewarded_quota, resolved_by, created_at, resolved_at)
SELECT id, guild_id, forum_thread_id, reporter_id,
       status::public.bug_status, rewarded_quota, resolved_by, created_at, resolved_at
FROM staging.bug_reports
ON CONFLICT (id) DO NOTHING;

-- 10. boost_slots (add FKs; shape unchanged).
INSERT INTO public.boost_slots
  (id, guild_id, member_id, source_message_id, created_at, next_payout_at, active, cancelled_at)
SELECT id, guild_id, member_id, source_message_id, created_at, next_payout_at, active, cancelled_at
FROM staging.boost_slots
ON CONFLICT (id) DO NOTHING;

-- 11. invite_joins + invite_seeds.
INSERT INTO public.invite_joins (id, guild_id, inviter_id, invitee_id, invite_code, created_at)
SELECT id, guild_id, inviter_id, invitee_id, invite_code, created_at
FROM staging.invite_joins
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.invite_seeds (id, guild_id, inviter_id, uses, created_at)
SELECT id, guild_id, inviter_id, uses, created_at
FROM staging.invite_seeds
ON CONFLICT (id) DO NOTHING;

-- 12. vote_role_holds (site -> enum).
INSERT INTO public.vote_role_holds (id, member_id, site, created_at)
SELECT id, member_id, site::public.vote_site, created_at
FROM staging.vote_role_holds
ON CONFLICT (id) DO NOTHING;

-- 13. grant_logs -> reward_grants. "system" granted_by -> NULL. guild_id was not
-- tracked on grant_logs, so NULL. source_type + source_id verbatim.
INSERT INTO public.reward_grants
  (id, target_member_id, guild_id, new_api_user_id, quota, reason, source_type, source_id, granted_by_member_id, created_at)
SELECT id, target_discord_id, NULL, new_api_user_id, quota, reason,
       source_type::public.reward_source, source_id,
       NULLIF(granted_by_discord_id, 'system'), created_at
FROM staging.grant_logs
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.reward_grants','id'),
       COALESCE((SELECT max(id) FROM public.reward_grants), 1));

-- 14. level_rewards: intentionally NOT migrated. The old rows were seed-marks
-- only; nobody was ever actually paid a level reward. Leaving reward_claims
-- empty for source='level' lets the always-reconcile logic back-pay every
-- linked member for the tiers they have earned by message count, once
-- LEVEL_GRANT_DOLLARS is set. reward_grants (vote/connect/boost) history IS
-- preserved above so those real payouts still dedupe.

-- Ticket/bug pending rewards: prod has ZERO pending rows (all pending_reward_*
-- NULL), so no ticket/bug claims are migrated. If any existed they would map to
-- reward_claims (source ticket/bug, ref=id) with status paid/pending.

-- Fix serial sequences for tables we copied explicit ids into.
SELECT setval(pg_get_serial_sequence('public.member_guilds','id'), COALESCE((SELECT max(id) FROM public.member_guilds),1));
SELECT setval(pg_get_serial_sequence('public.member_roles','id'), COALESCE((SELECT max(id) FROM public.member_roles),1));
SELECT setval(pg_get_serial_sequence('public.tickets','id'), COALESCE((SELECT max(id) FROM public.tickets),1));
SELECT setval(pg_get_serial_sequence('public.ticket_messages','id'), COALESCE((SELECT max(id) FROM public.ticket_messages),1));
SELECT setval(pg_get_serial_sequence('public.bug_reports','id'), COALESCE((SELECT max(id) FROM public.bug_reports),1));
SELECT setval(pg_get_serial_sequence('public.boost_slots','id'), COALESCE((SELECT max(id) FROM public.boost_slots),1));
SELECT setval(pg_get_serial_sequence('public.invite_joins','id'), COALESCE((SELECT max(id) FROM public.invite_joins),1));
SELECT setval(pg_get_serial_sequence('public.invite_seeds','id'), COALESCE((SELECT max(id) FROM public.invite_seeds),1));
SELECT setval(pg_get_serial_sequence('public.vote_role_holds','id'), COALESCE((SELECT max(id) FROM public.vote_role_holds),1));
SELECT setval(pg_get_serial_sequence('public.reward_claims','id'), COALESCE((SELECT max(id) FROM public.reward_claims),1));

COMMIT;
