-- ============================================================================
-- Schela — fix CHECK constraints that reject values the app actually produces
-- Run after 0011_resend_email_provider.sql.
--
-- Two real, shipping bugs, both the same class of mismatch between what the
-- UI/code writes and what the database permits:
--
-- 1. ai_state on candidates + interviews doesn't allow 'withdrawn'. The
--    withdrawal flow (AI tool call -> mark candidate withdrawn) would fail at
--    the database on EVERY withdrawal — 0010 widened the notifications.type
--    constraint for this feature but missed the two ai_state constraints it
--    also depends on.
--
-- 2. interviews.format doesn't allow 'In-person', but the New Interview
--    wizard offers exactly that option. Choosing it made interview creation
--    fail outright.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Allow the 'withdrawn' state
-- --------------------------------------------------------------------------
alter table candidates drop constraint candidates_ai_state_check;
alter table candidates add constraint candidates_ai_state_check
  check (ai_state in (
    'sending_invitation','waiting_reply','scheduling','rescheduling',
    'reminder_sent','calendar_updated','escalated','completed','withdrawn'
  ));

alter table interviews drop constraint interviews_ai_state_check;
alter table interviews add constraint interviews_ai_state_check
  check (ai_state in (
    'sending_invitation','waiting_reply','scheduling','rescheduling',
    'reminder_sent','calendar_updated','escalated','completed','withdrawn'
  ));

-- --------------------------------------------------------------------------
-- 2. Allow every interview format the wizard actually offers
-- --------------------------------------------------------------------------
alter table interviews drop constraint interviews_format_check;
alter table interviews add constraint interviews_format_check
  check (format in ('Google Meet', 'Zoom', 'Phone', 'In-person'));
