-- ============================================================================
-- Schela — application flow foundation
-- Run after 0021_unified_multichannel_conversations.sql.
--
-- An interview exists before a candidate chooses a slot, so scheduled_at must
-- be nullable during outreach/scheduling. Interviews also point at a real
-- per-org interviewer row while preserving the legacy interviewer text field
-- for historical rows and simple display.
-- ============================================================================

alter table interviews
  alter column scheduled_at drop not null;

alter table interviews
  add column if not exists interviewer_id uuid references interviewers(id) on delete set null,
  add column if not exists role_title text;

create index if not exists interviews_interviewer_id_idx on interviews(interviewer_id);

comment on column interviews.scheduled_at is
  'Null while Schela is coordinating availability. Set only after the candidate has actually booked/confirmed a slot.';
comment on column interviews.interviewer_id is
  'Real member of the hiring team selected for this interview. Legacy interviewer text remains for historical display.';
comment on column interviews.role_title is
  'Role/job this interview is for. Stored per interview because one candidate can interview for multiple roles over time.';
