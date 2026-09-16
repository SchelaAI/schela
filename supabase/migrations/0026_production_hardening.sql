-- ============================================================================
-- Schela — production hardening
-- Run after 0025_calendly_scheduling_engine.sql.
--
-- Security goals:
--   * Browser clients are read-only against operational workflow tables.
--   * Tenant membership cannot be changed by editing profiles.org_id.
--   * Internal/provider tables are not exposed to anon/authenticated roles.
--   * Integration config JSON is never selectable by browser clients.
--   * Public attachment exposure is removed until a signed/private media flow
--     is implemented.
--   * Adds DB-backed rate limiting + internal operational event logging.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Internal operational events. Service-role only.
-- --------------------------------------------------------------------------
create table if not exists operational_events (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('info','warning','error')),
  source text not null,
  event_type text not null,
  org_id uuid references organizations(id) on delete cascade,
  conversation_id text,
  interview_id bigint references interviews(id) on delete set null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operational_events_created_idx
  on operational_events(created_at desc);
create index if not exists operational_events_org_idx
  on operational_events(org_id, created_at desc)
  where org_id is not null;

alter table operational_events enable row level security;

-- --------------------------------------------------------------------------
-- DB-backed rate limiting for server actions. No IP/email values are stored;
-- callers pass an opaque SHA-256 key.
-- --------------------------------------------------------------------------
create table if not exists rate_limit_counters (
  rate_key text not null,
  scope text not null,
  window_started_at timestamptz not null,
  hit_count int not null default 0,
  primary key (rate_key, scope)
);

alter table rate_limit_counters enable row level security;

create or replace function public.consume_rate_limit(
  p_rate_key text,
  p_scope text,
  p_limit int,
  p_window_seconds int
)
returns table (
  allowed boolean,
  remaining int,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count int;
  current_start timestamptz;
  window_seconds int := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
  request_limit int := greatest(1, least(coalesce(p_limit, 10), 10000));
begin
  if p_rate_key is null or length(p_rate_key) < 16 or p_scope is null or length(p_scope) < 1 then
    raise exception 'Invalid rate limit key/scope';
  end if;

  insert into rate_limit_counters(rate_key, scope, window_started_at, hit_count)
  values (p_rate_key, p_scope, now(), 1)
  on conflict (rate_key, scope) do update
  set window_started_at = case
        when rate_limit_counters.window_started_at <= now() - make_interval(secs => window_seconds)
          then now()
        else rate_limit_counters.window_started_at
      end,
      hit_count = case
        when rate_limit_counters.window_started_at <= now() - make_interval(secs => window_seconds)
          then 1
        else rate_limit_counters.hit_count + 1
      end
  returning hit_count, window_started_at into current_count, current_start;

  allowed := current_count <= request_limit;
  remaining := greatest(0, request_limit - current_count);
  retry_after_seconds := greatest(
    0,
    ceil(extract(epoch from (current_start + make_interval(secs => window_seconds) - now())))::int
  );
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text,text,int,int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,text,int,int) to service_role;

-- --------------------------------------------------------------------------
-- Data-API grants: deny-by-default for browser roles.
-- Server actions that mutate workflow state authenticate the user first, then
-- use the service role. Browser clients only need tenant-scoped SELECT access.
-- --------------------------------------------------------------------------
revoke all on table organizations, profiles, candidates, interviews, conversations,
  messages, action_items, notifications, integrations, ai_decisions, interviewers,
  webhook_events, whatsapp_thread_routes, whatsapp_unmatched_messages,
  email_thread_routes, email_unmatched_messages, ai_message_runs,
  calendly_connections, calendly_booking_routes, operational_events,
  rate_limit_counters
from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;

-- Public app data visible only after authentication; RLS still decides rows.
grant select on table organizations, profiles, candidates, interviews, conversations,
  messages, action_items, notifications, ai_decisions, interviewers
  to authenticated;

-- Do not expose integrations.config to browser clients.
grant select (id, org_id, name, icon, connected, account, last_synced)
  on integrations to authenticated;

-- No authenticated INSERT/UPDATE/DELETE grants are intentionally given above.
-- All mutations go through authenticated server actions / provider handlers.

-- `current_org_id()` is used by RLS. Do not expose it to unauthenticated users.
revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated, service_role;

-- Trigger helper is not an application RPC.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Attachments: previous migrations created a public bucket for a media flow
-- that is not implemented in the current product. Candidate material must not
-- be world-readable. Re-enable only with signed URLs / provider media upload.
-- --------------------------------------------------------------------------
update storage.buckets
set public = false
where id = 'attachments';

drop policy if exists "public read attachments" on storage.objects;

-- --------------------------------------------------------------------------
-- Retention / cleanup helpers for duplicated provider diagnostics.
-- Core interview/candidate/message data is NOT auto-deleted here.
-- --------------------------------------------------------------------------
create index if not exists webhook_events_processed_idx on webhook_events(processed_at);
create index if not exists whatsapp_unmatched_created_idx on whatsapp_unmatched_messages(created_at);
create index if not exists email_unmatched_created_idx on email_unmatched_messages(created_at);

create or replace function public.prune_schela_operational_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from webhook_events where processed_at < now() - interval '30 days';
  delete from whatsapp_unmatched_messages where created_at < now() - interval '30 days';
  delete from email_unmatched_messages where created_at < now() - interval '30 days';
  delete from operational_events where created_at < now() - interval '90 days';
  delete from rate_limit_counters where window_started_at < now() - interval '2 days';
end;
$$;

revoke all on function public.prune_schela_operational_data() from public, anon, authenticated;
grant execute on function public.prune_schela_operational_data() to service_role;

-- --------------------------------------------------------------------------
-- Composite tenant FKs on route/conversation tables. This makes cross-org
-- linkage impossible even if future server code accidentally supplies a valid
-- ID from another tenant.
-- --------------------------------------------------------------------------
alter table interviews
  add constraint interviews_id_org_unique unique (id, org_id);

alter table conversations
  drop constraint if exists conversations_interview_id_fkey;
alter table conversations
  add constraint conversations_interview_org_fkey
  foreign key (interview_id, org_id) references interviews(id, org_id) on delete cascade;

alter table whatsapp_thread_routes
  drop constraint if exists whatsapp_thread_routes_interview_id_fkey;
alter table whatsapp_thread_routes
  add constraint whatsapp_thread_routes_interview_org_fkey
  foreign key (interview_id, org_id) references interviews(id, org_id) on delete cascade;

alter table email_thread_routes
  drop constraint if exists email_thread_routes_interview_id_fkey;
alter table email_thread_routes
  add constraint email_thread_routes_interview_org_fkey
  foreign key (interview_id, org_id) references interviews(id, org_id) on delete cascade;

alter table calendly_booking_routes
  drop constraint if exists calendly_booking_routes_interview_id_fkey;
alter table calendly_booking_routes
  add constraint calendly_booking_routes_interview_org_fkey
  foreign key (interview_id, org_id) references interviews(id, org_id) on delete cascade;

-- --------------------------------------------------------------------------
-- Harden SECURITY DEFINER lookup and preserve tenant ids on nullable composite
-- foreign keys. PostgreSQL 17 (current Supabase platform default) supports
-- column-targeted ON DELETE SET NULL.
-- --------------------------------------------------------------------------
alter function public.current_org_id() set search_path = public;

-- These composite FKs were introduced in 0016. Without a SET NULL column list,
-- PostgreSQL would also try to null org_id when the referenced row is deleted.
alter table action_items
  drop constraint if exists action_items_conversation_id_fkey;
alter table action_items
  add constraint action_items_conversation_id_fkey
  foreign key (conversation_id, org_id) references conversations(id, org_id)
  on delete set null (conversation_id);

alter table notifications
  drop constraint if exists notifications_link_candidate_id_fkey;
alter table notifications
  add constraint notifications_link_candidate_id_fkey
  foreign key (link_candidate_id, org_id) references candidates(id, org_id)
  on delete set null (link_candidate_id);

alter table notifications
  drop constraint if exists notifications_link_conversation_id_fkey;
alter table notifications
  add constraint notifications_link_conversation_id_fkey
  foreign key (link_conversation_id, org_id) references conversations(id, org_id)
  on delete set null (link_conversation_id);

alter table ai_decisions
  drop constraint if exists ai_decisions_conversation_id_fkey;
alter table ai_decisions
  add constraint ai_decisions_conversation_id_fkey
  foreign key (conversation_id, org_id) references conversations(id, org_id)
  on delete set null (conversation_id);

-- Add the same tenant binding to interview/message references that began as
-- globally unique single-column IDs.
alter table messages
  add constraint messages_id_org_unique unique (id, org_id);

alter table action_items
  drop constraint if exists action_items_interview_id_fkey;
alter table action_items
  add constraint action_items_interview_id_fkey
  foreign key (interview_id, org_id) references interviews(id, org_id)
  on delete set null (interview_id);

alter table notifications
  drop constraint if exists notifications_link_interview_id_fkey;
alter table notifications
  add constraint notifications_link_interview_id_fkey
  foreign key (link_interview_id, org_id) references interviews(id, org_id)
  on delete set null (link_interview_id);

alter table ai_decisions
  drop constraint if exists ai_decisions_message_id_fkey;
alter table ai_decisions
  add constraint ai_decisions_message_id_fkey
  foreign key (message_id, org_id) references messages(id, org_id)
  on delete set null (message_id);
