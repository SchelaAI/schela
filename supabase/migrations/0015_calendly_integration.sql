-- ============================================================================
-- Schela — add Calendly integration + interview format
-- Run after 0014_remove_google_calendar.sql.
--
-- 1. interviews.format has a CHECK constraint listing the allowed values —
--    the New Interview wizard now offers "Calendly" as a format, and without
--    this the constraint would reject it (the same class of bug fixed for
--    "In-person" in 0012).
-- ============================================================================

alter table interviews drop constraint interviews_format_check;
alter table interviews add constraint interviews_format_check
  check (format in ('Google Meet', 'Zoom', 'Calendly', 'Phone', 'In-person'));
