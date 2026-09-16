-- ============================================================================
-- Schela — multi-tenant hiring-company branding + real interviewers
-- Run after 0002_settings.sql.
--
-- Two things this migration establishes:
--   1. The organization IS the tenant's hiring company. `organizations.name`
--      is the brand candidates see ("on behalf of Acme"), never "Schela".
--      Schela only appears as a "Powered by Schela" mark in the recruiter's
--      own dashboard — controllable per-org via powered_by_schela.
--   2. Interviewers are real per-org rows, not a hardcoded list. A fresh org
--      starts with ZERO interviewers (no seeded fake people) — the recruiter
--      adds their own team in Settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ORGANIZATION branding columns
-- ---------------------------------------------------------------------------
alter table organizations
  add column if not exists website text,
  add column if not exists powered_by_schela boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- INTERVIEWERS — the org's own hiring team (replaces the old hardcoded list)
-- ---------------------------------------------------------------------------
create table if not exists interviewers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  role text,                 -- e.g. "Engineering Lead", "Hiring Manager"
  email text,
  availability text not null default 'available' check (availability in ('available','busy','away')),
  created_at timestamptz not null default now()
);
create index if not exists interviewers_org_id_idx on interviewers(org_id);

alter table interviewers enable row level security;

create policy "org members can manage their interviewers" on interviewers
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- Let org members RENAME / update their own organization.
-- 0001 only granted SELECT on organizations; renaming the hiring company
-- (and toggling the Powered-by mark) needs UPDATE, still scoped to own org.
-- ---------------------------------------------------------------------------
create policy "org members can update their org" on organizations
  for update using (id = public.current_org_id()) with check (id = public.current_org_id());
