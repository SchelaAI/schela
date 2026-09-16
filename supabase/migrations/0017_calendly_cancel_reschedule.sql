-- ============================================================================
-- Schela — real Calendly cancellation + reschedule
-- Run after 0016_fix_candidate_conversation_pk.sql.
--
-- Found by direct code audit: notifyCancellation() and rescheduleInterview()
-- only ever messaged the candidate — neither touched Calendly's API at all,
-- so cancelling or rescheduling an interview in Schela left the actual
-- Calendly booking (and the interviewer's real calendar event underneath it)
-- untouched. Fixing this requires actually knowing which Calendly event a
-- given interview corresponds to, which was never stored — the webhook only
-- ever wrote scheduled_at and meeting_link.
-- ============================================================================

alter table interviews
  add column if not exists calendly_event_uri text;

comment on column interviews.calendly_event_uri is
  'The Calendly scheduled_event URI once a candidate books through a Calendly link — needed to actually cancel/reschedule the booking via Calendly''s API, not just update Schela''s own row.';
