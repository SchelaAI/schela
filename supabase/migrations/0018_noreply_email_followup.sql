-- ============================================================================
-- Schela — 24-hour no-reply email fallback
-- Run after 0017_calendly_cancel_reschedule.sql.
--
-- Core flow requirement: if a candidate doesn't reply to the WhatsApp
-- invitation within 24 hours, Schela follows up on the OTHER channel (email)
-- rather than repeating itself on a channel the candidate is clearly not
-- reading.
--
-- Stamped so the cron is idempotent: only interviews with a null stamp are
-- picked up, so overlapping runs or retries can't send the follow-up twice.
-- ============================================================================

alter table interviews
  add column if not exists followup_email_sent_at timestamptz;

comment on column interviews.followup_email_sent_at is
  'When the cross-channel (email) follow-up was sent after 24h of no candidate reply. Null = not yet sent.';

-- The follow-up scan filters on this, and on interviews still awaiting a reply.
create index if not exists interviews_followup_scan_idx
  on interviews(org_id, ai_state, followup_email_sent_at);
