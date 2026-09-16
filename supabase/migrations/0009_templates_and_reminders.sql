-- ============================================================================
-- Schela — WhatsApp templates + scheduled reminders
-- Run after 0008_message_attachments.sql.
--
-- TEMPLATES: WhatsApp only allows free-form text within 24 hours of the
-- candidate's last message. A first contact must use a template approved by
-- Meta. The template is created and approved by the business in WhatsApp
-- Manager, so its NAME can't be hardcoded — each org configures their own.
--
-- REMINDERS: interviews need "sent already?" tracking so the cron job that
-- fires 24h and 1h reminders is idempotent and can't double-send if it runs
-- more than once or retries.
-- ============================================================================

alter table organizations
  -- Name of the org's approved outreach template, e.g. 'interview_invitation'.
  add column if not exists wa_template_name text,
  add column if not exists wa_template_language text not null default 'en_US';

comment on column organizations.wa_template_name is
  'Approved WhatsApp template used for first contact (outside the 24h window). Null = cold outreach unavailable.';

alter table interviews
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_1h_sent_at timestamptz;

-- The reminder cron scans for upcoming interviews; this keeps that scan cheap.
create index if not exists interviews_scheduled_at_idx on interviews(scheduled_at);
