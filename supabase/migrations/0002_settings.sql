-- ============================================================================
-- Schela — settings columns
-- Adds the fields the Settings screen actually needs to persist. Run this
-- after 0001_init.sql. Everything defaults to match what the UI already
-- shows so existing rows don't suddenly look different.
-- ============================================================================

alter table profiles
  add column if not exists phone text,
  add column if not exists ai_confidence_threshold int not null default 65,
  add column if not exists ai_auto_execute boolean not null default true,
  add column if not exists ai_log_decisions boolean not null default true,
  add column if not exists scheduling_duration text not null default '45m',
  add column if not exists scheduling_buffer_min int not null default 15,
  add column if not exists scheduling_reschedule_limit int not null default 3,
  add column if not exists working_hours_start text not null default '09:00',
  add column if not exists working_hours_end text not null default '18:00',
  add column if not exists notif_new_reply boolean not null default true,
  add column if not exists notif_confirmed boolean not null default true,
  add column if not exists notif_reminders boolean not null default true,
  add column if not exists notif_weekly_digest boolean not null default false,
  add column if not exists email_from_name text,
  add column if not exists email_from_address text,
  add column if not exists email_reply_to text,
  add column if not exists email_signature text;
