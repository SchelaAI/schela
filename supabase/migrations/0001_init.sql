-- ============================================================================
-- Schela — initial schema
-- Run this in the Supabase SQL Editor (or `supabase db push` with the CLI)
-- on a fresh project, before anything else.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ============================================================================
-- ORGANIZATIONS & PROFILES
-- One organization per signup by default (solo recruiter, per the product's
-- own positioning — "not built for team hierarchies"). profiles.org_id is
-- the single source of truth every other table's RLS policy checks against.
-- ============================================================================

create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_url text,
  -- Onboarding fields (Screen 3 of the onboarding flow)
  onboarding_role text,               -- 'Individual Recruiter' | 'TA Lead' | 'Hiring Manager' | 'Team Lead' | 'Founder' | 'Other'
  company text,
  team_size text,                     -- 'Solo' | '2–5' | '6–20' | '20+'
  channel_preference text,            -- 'wa' | 'em' | 'both'  (onboarding step 2)
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row the moment a new auth.users row appears —
-- covers Google, LinkedIn, and email/password signup identically, so the
-- app never has to special-case "did the profile get created yet."
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- CANDIDATES
-- Mirrors lib/types.ts `Candidate` exactly — job_position and
-- preferred_channel are nullable, since (per the Add Candidate modal fix)
-- those are decided at interview-scheduling time, not candidate creation.
-- ============================================================================

create table candidates (
  id text primary key,                -- e.g. 'PK', 'AS' — matches the UI's short-id avatar convention
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  job_position text,
  country_code text not null,
  phone text not null,
  email text not null,
  preferred_channel text check (preferred_channel in ('wa','em')),
  time_zone text,
  notes text,
  ai_state text not null default 'sending_invitation' check (ai_state in (
    'sending_invitation','waiting_reply','scheduling','rescheduling',
    'reminder_sent','calendar_updated','escalated','completed'
  )),
  score int not null default 75,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidates_org_id_idx on candidates(org_id);

-- ============================================================================
-- INTERVIEWS
-- ============================================================================

create table interviews (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  candidate_id text not null references candidates(id) on delete cascade,
  scheduled_at timestamptz not null,   -- real timestamp — group labels (Today/Tomorrow/...) are derived at query time, never stored stale
  duration_minutes int not null default 45,
  format text not null default 'Google Meet' check (format in ('Google Meet','Zoom','Phone')),
  channel text not null check (channel in ('wa','em')),
  ai_state text not null default 'sending_invitation' check (ai_state in (
    'sending_invitation','waiting_reply','scheduling','rescheduling',
    'reminder_sent','calendar_updated','escalated','completed'
  )),
  interviewer text not null,
  handled_by text not null default 'ai' check (handled_by in ('ai','you')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index interviews_org_id_idx on interviews(org_id);
create index interviews_candidate_id_idx on interviews(candidate_id);
create index interviews_scheduled_at_idx on interviews(scheduled_at);

-- ============================================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================================

create table conversations (
  id text primary key,                -- e.g. 'c-pk'
  org_id uuid not null references organizations(id) on delete cascade,
  candidate_id text not null references candidates(id) on delete cascade,
  channel text not null check (channel in ('wa','em')),
  unread boolean not null default false,
  escalated boolean not null default false,
  confidence numeric(4,2),
  suggested_reply text,
  updated_at timestamptz not null default now()
);
create index conversations_org_id_idx on conversations(org_id);

create table messages (
  id bigint generated always as identity primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  from_role text not null check (from_role in ('schela','candidate','system')),
  text text not null,
  channel text check (channel in ('wa','em')),
  created_at timestamptz not null default now()
);
create index messages_conversation_id_idx on messages(conversation_id);

-- ============================================================================
-- ACTION ITEMS (Dashboard "Action Required" workspace)
-- ============================================================================

create table action_items (
  id text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  category text not null check (category in (
    'compensation','visa','multiple_reschedules','candidate_unavailable','low_confidence','manual_approval'
  )),
  candidate_id text references candidates(id) on delete cascade,
  conversation_id text references conversations(id) on delete set null,
  interview_id bigint references interviews(id) on delete set null,
  summary text not null,
  confidence numeric(4,2),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index action_items_org_id_idx on action_items(org_id);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

create table notifications (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('escalated','calendar_updated','rescheduling','reminder_sent')),
  title text not null,
  description text not null,
  unread boolean not null default true,
  link_candidate_id text references candidates(id) on delete set null,
  link_conversation_id text references conversations(id) on delete set null,
  link_interview_id bigint references interviews(id) on delete set null,
  created_at timestamptz not null default now()
);
create index notifications_org_id_idx on notifications(org_id);

-- ============================================================================
-- INTEGRATIONS
-- ============================================================================

create table integrations (
  id text primary key,                -- e.g. 'google_calendar', 'whatsapp'
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  icon text not null,
  connected boolean not null default false,
  account text,
  last_synced timestamptz
);
create index integrations_org_id_idx on integrations(org_id);

-- ============================================================================
-- AI DECISION LOG — audit trail for every AI classification/action
-- (see the AI Orchestration Plan doc). Never skip writing to this table;
-- it's the primary way to debug a bad AI decision after the fact.
-- ============================================================================

create table ai_decisions (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  conversation_id text references conversations(id) on delete set null,
  message_id bigint references messages(id) on delete set null,
  tier text not null check (tier in ('tier1','tier2','human')),
  model text,
  intent text,
  confidence numeric(4,2),
  action_taken text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
create index ai_decisions_org_id_idx on ai_decisions(org_id);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- Every table is scoped to the caller's own organization via their profile.
-- This is the actual security boundary — the anon key alone grants nothing.
-- ============================================================================

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table candidates enable row level security;
alter table interviews enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table action_items enable row level security;
alter table notifications enable row level security;
alter table integrations enable row level security;
alter table ai_decisions enable row level security;

create function public.current_org_id()
returns uuid
language sql security definer stable
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create policy "org members can read their org" on organizations
  for select using (id = public.current_org_id());

create policy "users can read their own profile" on profiles
  for select using (id = auth.uid());
create policy "users can update their own profile" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "org members can manage their candidates" on candidates
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can manage their interviews" on interviews
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can manage their conversations" on conversations
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can manage their messages" on messages
  for all using (
    conversation_id in (select id from conversations where org_id = public.current_org_id())
  ) with check (
    conversation_id in (select id from conversations where org_id = public.current_org_id())
  );

create policy "org members can manage their action items" on action_items
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can manage their notifications" on notifications
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can manage their integrations" on integrations
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create policy "org members can read their ai decisions" on ai_decisions
  for select using (org_id = public.current_org_id());
