-- ============================================================================
-- Schela — WhatsApp messaging engine
-- Run after 0022_product_app_foundation.sql.
--
-- Adds safe multi-tenant routing for inbound WhatsApp replies, richer message
-- delivery state, normalized candidate phone lookup, and fixes the interview
-- format constraint so the existing "Calendly" UI option is actually valid.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Candidate phone normalization
-- --------------------------------------------------------------------------
alter table candidates
  add column if not exists phone_e164 text;

update candidates
set phone_e164 = regexp_replace(coalesce(country_code, '') || coalesce(phone, ''), '[^0-9]', '', 'g')
where phone_e164 is null;

create index if not exists candidates_phone_e164_idx
  on candidates(phone_e164) where phone_e164 is not null;

comment on column candidates.phone_e164 is
  'Digits-only E.164-style WhatsApp address used for provider routing, e.g. 14155551234.';

-- --------------------------------------------------------------------------
-- Real provider delivery state
-- --------------------------------------------------------------------------
alter table messages
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists provider_status_at timestamptz;

alter table messages drop constraint if exists messages_delivery_status_check;
alter table messages add constraint messages_delivery_status_check
  check (delivery_status in ('pending','accepted','sent','delivered','read','failed','received'));

update messages
set delivery_status = case
  when from_role = 'candidate' then 'received'
  when delivery_error is not null then 'failed'
  when delivered then 'delivered'
  else 'pending'
end;

create unique index if not exists messages_whatsapp_message_unique_idx
  on messages(org_id, whatsapp_message_id)
  where whatsapp_message_id is not null;

-- --------------------------------------------------------------------------
-- Safe inbound routing for a shared Schela sender number
--
-- We deliberately do NOT locate a tenant by scanning candidates for a phone
-- number. The same human can be a candidate at multiple customer companies.
-- Instead, every successful outbound interview invitation claims a route from
-- (our sender phone-number-id, candidate WhatsApp id) -> exact conversation.
-- --------------------------------------------------------------------------
create table if not exists whatsapp_thread_routes (
  sender_phone_number_id text not null,
  candidate_wa_id text not null,
  org_id uuid not null references organizations(id) on delete cascade,
  candidate_id text not null,
  conversation_id text not null,
  interview_id bigint not null references interviews(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (sender_phone_number_id, candidate_wa_id),
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade,
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade
);

create index if not exists whatsapp_thread_routes_conversation_idx
  on whatsapp_thread_routes(org_id, conversation_id);
create index if not exists whatsapp_thread_routes_expiry_idx
  on whatsapp_thread_routes(expires_at);

alter table whatsapp_thread_routes enable row level security;
-- Intentionally no browser policies. Server provider code uses service role.

-- Atomic route claim. A shared sender cannot safely run two active interview
-- threads to the same WhatsApp identity at once. If that happens we refuse the
-- second send instead of risking cross-tenant message leakage.
create or replace function public.claim_whatsapp_thread_route(
  p_sender_phone_number_id text,
  p_candidate_wa_id text,
  p_org_id uuid,
  p_candidate_id text,
  p_conversation_id text,
  p_interview_id bigint,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing whatsapp_thread_routes%rowtype;
begin
  insert into whatsapp_thread_routes (
    sender_phone_number_id, candidate_wa_id, org_id, candidate_id,
    conversation_id, interview_id, claimed_at, expires_at
  ) values (
    p_sender_phone_number_id, p_candidate_wa_id, p_org_id, p_candidate_id,
    p_conversation_id, p_interview_id, now(), p_expires_at
  )
  on conflict do nothing;

  if found then
    return true;
  end if;

  select * into existing
  from whatsapp_thread_routes
  where sender_phone_number_id = p_sender_phone_number_id
    and candidate_wa_id = p_candidate_wa_id
  for update;

  if existing.conversation_id = p_conversation_id
     or existing.expires_at <= now() then
    update whatsapp_thread_routes
    set org_id = p_org_id,
        candidate_id = p_candidate_id,
        conversation_id = p_conversation_id,
        interview_id = p_interview_id,
        claimed_at = now(),
        expires_at = p_expires_at
    where sender_phone_number_id = p_sender_phone_number_id
      and candidate_wa_id = p_candidate_wa_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_whatsapp_thread_route(text,text,uuid,text,text,bigint,timestamptz) from public;
grant execute on function public.claim_whatsapp_thread_route(text,text,uuid,text,text,bigint,timestamptz) to service_role;

-- Provider events that cannot be matched safely are retained for operators
-- rather than silently discarded.
create table if not exists whatsapp_unmatched_messages (
  id bigint generated always as identity primary key,
  whatsapp_message_id text not null unique,
  sender_phone_number_id text,
  candidate_wa_id text,
  message_type text,
  text text,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table whatsapp_unmatched_messages enable row level security;
-- No browser policies. Internal/server diagnostics only.

-- --------------------------------------------------------------------------
-- Existing product UI already offers Calendly. Make DB agree with the UI.
-- --------------------------------------------------------------------------
alter table interviews drop constraint if exists interviews_format_check;
alter table interviews add constraint interviews_format_check
  check (format in ('Calendly','Google Meet','Zoom','Phone','In-person'));


-- --------------------------------------------------------------------------
-- Realtime thread updates
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'interviews'
  ) then
    alter publication supabase_realtime add table interviews;
  end if;
end $$;
