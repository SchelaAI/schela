-- ============================================================================
-- Schela — production conversation orchestration foundation
-- Run after 0020_email_threading.sql.
--
-- Makes one conversation span WhatsApp + email for one interview, adds the
-- timestamps required for the 24h fallback, and adds webhook idempotency.
-- ============================================================================

alter table conversations
  add column if not exists interview_id bigint references interviews(id) on delete cascade,
  add column if not exists primary_channel text check (primary_channel in ('wa','em'));

update conversations
set primary_channel = channel
where primary_channel is null;

create index if not exists conversations_interview_id_idx
  on conversations(interview_id);

-- One active Schela thread per interview. Multiple historical interviews for
-- the same candidate therefore remain separate and cannot pollute AI context.
create unique index if not exists conversations_interview_unique_idx
  on conversations(interview_id)
  where interview_id is not null;

-- `channel` is retained for backwards compatibility with older application
-- code, but messages.channel is authoritative for individual message transport.
comment on column conversations.channel is
  'Legacy/primary transport hint. Do not use to determine a message transport; messages.channel is authoritative.';
comment on column conversations.primary_channel is
  'Preferred/initial transport for this interview conversation. The thread itself may span WhatsApp and email.';

alter table interviews
  add column if not exists initial_outreach_sent_at timestamptz,
  add column if not exists last_candidate_reply_at timestamptz,
  add column if not exists followup_email_claimed_at timestamptz;

create index if not exists interviews_noreply_fallback_idx
  on interviews(initial_outreach_sent_at, followup_email_sent_at, followup_email_claimed_at)
  where ai_state = 'waiting_reply';

comment on column interviews.initial_outreach_sent_at is
  'Timestamp of the first successful candidate outreach. The 24h fallback window starts here, never at interview.created_at.';
comment on column interviews.last_candidate_reply_at is
  'Most recent inbound candidate reply across all channels for this interview.';
comment on column interviews.followup_email_claimed_at is
  'Short-lived idempotency claim used by the follow-up worker before sending the 24h email fallback.';

-- Webhooks are retried by Meta, Resend and Calendly. This ledger lets route
-- handlers atomically ignore duplicate provider events.
create table if not exists webhook_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('whatsapp','resend','calendly')),
  event_id text not null,
  event_type text,
  processed_at timestamptz not null default now(),
  payload jsonb,
  unique(provider, event_id)
);

alter table webhook_events enable row level security;
-- No browser policies on purpose. Webhook routes use the service role.
