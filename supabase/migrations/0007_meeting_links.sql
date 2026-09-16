-- ============================================================================
-- Schela — real meeting links + scheduling correctness
-- Run after 0006_integration_connectors.sql.
--
-- Companion to a server-side fix (not a migration): createInterview() used
-- to reconstruct scheduled_at from only the picked HOUR, silently discarding
-- which day the recruiter picked — every new interview landed on today's
-- date regardless of the weekday chosen in the wizard. That's now fixed in
-- code; this migration adds where a real meeting link lives once an
-- interview actually gets a calendar event created for it (Google Calendar,
-- when connected) instead of the permanently-disabled "No Link Yet" button.
-- ============================================================================

alter table interviews
  add column if not exists meeting_link text,
  add column if not exists calendar_event_id text;
