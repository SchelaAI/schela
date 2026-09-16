-- ============================================================================
-- Schela — AI + Resend cross-channel orchestration
-- Run after 0023_whatsapp_messaging_engine.sql.
--
-- Adds one-shot AI processing claims, safe inbound email routing, Resend
-- provider ids/thread metadata, unmatched-email diagnostics, and an atomic
-- claim function for the 24-hour WhatsApp -> email fallback worker.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Email transport metadata
-- --------------------------------------------------------------------------
alter table messages
  add column if not exists resend_email_id text,
  add column if not exists email_subject text;

create unique index if not exists messages_resend_email_id_unique_idx
  on messages(resend_email_id)
  where resend_email_id is not null;

create unique index if not exists messages_email_message_id_unique_idx
  on messages(org_id, email_message_id)
  where email_message_id is not null;

-- --------------------------------------------------------------------------
-- Safe inbound email routing
--
-- Every interview conversation gets an unguessable local-part on the inbound
-- domain. We route on that address rather than searching candidates by email,
-- because the same person can interview with multiple Schela customers.
-- --------------------------------------------------------------------------
create table if not exists email_thread_routes (
  id uuid primary key default uuid_generate_v4(),
  route_token text not null unique,
  inbound_address text not null unique,
  org_id uuid not null references organizations(id) on delete cascade,
  candidate_id text not null,
  conversation_id text not null,
  interview_id bigint not null references interviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade,
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade,
  unique(org_id, conversation_id)
);

create index if not exists email_thread_routes_interview_idx
  on email_thread_routes(org_id, interview_id);

alter table email_thread_routes enable row level security;
-- No browser policies. Provider routes use the service role.

create table if not exists email_unmatched_messages (
  id bigint generated always as identity primary key,
  resend_email_id text,
  email_message_id text,
  recipient text,
  sender text,
  subject text,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists email_unmatched_provider_unique_idx
  on email_unmatched_messages(resend_email_id)
  where resend_email_id is not null;

alter table email_unmatched_messages enable row level security;
-- Internal/server diagnostics only.

-- --------------------------------------------------------------------------
-- AI one-shot claims
--
-- Provider webhooks retry. A webhook retry must never create a second AI
-- response for the same inbound candidate message.
-- --------------------------------------------------------------------------
create table if not exists ai_message_runs (
  inbound_message_id bigint primary key references messages(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  conversation_id text not null,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade
);

create index if not exists ai_message_runs_org_idx
  on ai_message_runs(org_id, started_at desc);

alter table ai_message_runs enable row level security;
-- Internal/server orchestration only.

-- --------------------------------------------------------------------------
-- Atomic claim for 24h no-reply fallback
-- --------------------------------------------------------------------------
create or replace function public.claim_noreply_email_followups(p_limit int default 25)
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
  return query
  with due as (
    select i.id
    from interviews i
    where i.ai_state = 'waiting_reply'
      and i.channel = 'wa'
      and i.initial_outreach_sent_at is not null
      and i.initial_outreach_sent_at <= now() - interval '24 hours'
      and i.followup_email_sent_at is null
      and (i.last_candidate_reply_at is null or i.last_candidate_reply_at < i.initial_outreach_sent_at)
      and (i.followup_email_claimed_at is null or i.followup_email_claimed_at <= now() - interval '15 minutes')
    order by i.initial_outreach_sent_at asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), claimed as (
    update interviews i
    set followup_email_claimed_at = now()
    from due
    where i.id = due.id
    returning i.id, i.org_id, i.candidate_id
  )
  select claimed.id, claimed.org_id, claimed.candidate_id from claimed;
end;
$$;

revoke all on function public.claim_noreply_email_followups(int) from public;
grant execute on function public.claim_noreply_email_followups(int) to service_role;
