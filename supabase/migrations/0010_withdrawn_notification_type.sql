-- ============================================================================
-- Schela — allow the 'withdrawn' notification type
-- Run after 0009_templates_and_reminders.sql.
--
-- notifications.type has a CHECK constraint listing the allowed values. The
-- new withdraw_application AI tool inserts a notification of type
-- 'withdrawn', which the existing constraint doesn't permit — without this,
-- every withdrawal notification insert would fail at runtime.
-- ============================================================================

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('escalated', 'calendar_updated', 'rescheduling', 'reminder_sent', 'withdrawn'));
