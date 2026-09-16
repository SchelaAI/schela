-- ============================================================================
-- Schela — Calendly OAuth + scheduling execution
-- Run after 0024_ai_email_fallback_engine.sql.
--
-- Keeps OAuth credentials in a service-role-only table, maps company
-- interviewers to real Calendly event types, correlates booking webhooks to
-- the exact Schela interview with opaque UTM route tokens, and adds atomic
-- reminder claims for the existing cron-job.org worker.
-- ============================================================================

create table if not exists calendly_connections (
  org_id uuid primary key references organizations(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  owner_uri text not null,
  organization_uri text not null,
  account_name text,
  account_email text,
  webhook_subscription_uri text,
  webhook_scope text check (webhook_scope in ('user','organization')),
  default_event_type_uri text,
  default_event_type_name text,
  refresh_claimed_until timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table calendly_connections enable row level security;
-- Intentionally no browser policies. OAuth credentials are service-role only.

alter table interviewers
  add column if not exists calendly_event_type_uri text,
  add column if not exists calendly_event_type_name text;

alter table interviews
  add column if not exists calendly_event_type_uri text,
  add column if not exists calendly_invitee_uri text,
  add column if not exists calendly_cancel_url text,
  add column if not exists calendly_reschedule_url text,
  add column if not exists calendly_booking_link_sent_at timestamptz;

create index if not exists interviews_calendly_event_uri_idx
  on interviews(calendly_event_uri)
  where calendly_event_uri is not null;

create index if not exists interviews_calendly_invitee_uri_idx
  on interviews(calendly_invitee_uri)
  where calendly_invitee_uri is not null;

create table if not exists calendly_booking_routes (
  route_token text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  interview_id bigint not null references interviews(id) on delete cascade,
  candidate_id text not null,
  conversation_id text not null,
  event_type_uri text not null,
  booking_url text,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade,
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade
);

create index if not exists calendly_booking_routes_interview_idx
  on calendly_booking_routes(org_id, interview_id, created_at desc);

alter table calendly_booking_routes enable row level security;
-- Service-role only. The route token is carried as hidden UTM correlation data.

-- Calendly refresh tokens are rotating/single-use. This short lease ensures
-- only one server request can consume a refresh token at a time.
create or replace function public.claim_calendly_token_refresh(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_token text;
begin
  update calendly_connections
  set refresh_claimed_until = now() + interval '30 seconds',
      updated_at = now()
  where org_id = p_org_id
    and (refresh_claimed_until is null or refresh_claimed_until < now())
  returning refresh_token into claimed_token;

  return claimed_token;
end;
$$;

revoke all on function public.claim_calendly_token_refresh(uuid) from public;
grant execute on function public.claim_calendly_token_refresh(uuid) to service_role;

create or replace function public.claim_due_interview_reminders(
  p_kind text,
  p_limit int default 25
)
returns table (
  interview_id bigint,
  org_id uuid,
  candidate_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('24h', '1h') then
    raise exception 'Unsupported reminder kind: %', p_kind;
  end if;

  if p_kind = '24h' then
    return query
    with due as (
      select i.id
      from interviews i
      where i.scheduled_at is not null
        and i.scheduled_at > now() + interval '1 hour'
        and i.scheduled_at <= now() + interval '24 hours'
        and i.reminder_24h_sent_at is null
        and i.ai_state <> 'completed'
      order by i.scheduled_at asc
      limit greatest(1, least(coalesce(p_limit, 25), 100))
      for update skip locked
    ), claimed as (
      update interviews i
      set reminder_24h_sent_at = now()
      from due
      where i.id = due.id
      returning i.id, i.org_id, i.candidate_id
    )
    select claimed.id, claimed.org_id, claimed.candidate_id from claimed;
  else
    return query
    with due as (
      select i.id
      from interviews i
      where i.scheduled_at is not null
        and i.scheduled_at > now()
        and i.scheduled_at <= now() + interval '1 hour'
        and i.reminder_1h_sent_at is null
        and i.ai_state <> 'completed'
      order by i.scheduled_at asc
      limit greatest(1, least(coalesce(p_limit, 25), 100))
      for update skip locked
    ), claimed as (
      update interviews i
      set reminder_1h_sent_at = now()
      from due
      where i.id = due.id
      returning i.id, i.org_id, i.candidate_id
    )
    select claimed.id, claimed.org_id, claimed.candidate_id from claimed;
  end if;
end;
$$;

revoke all on function public.claim_due_interview_reminders(text, int) from public;
grant execute on function public.claim_due_interview_reminders(text, int) to service_role;
