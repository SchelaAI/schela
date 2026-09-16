-- ============================================================================
-- Schela — message delivery status
-- Run after 0003_multitenant_branding.sql.
--
-- Previously, delivery failures (e.g. "WhatsApp not configured — missing
-- WHATSAPP_PHONE_NUMBER_ID") were concatenated directly into the message
-- text shown to the recruiter. That's both misleading (looks like part of
-- what was sent to the candidate) and dangerous for layout — a long
-- diagnostic string with no natural line breaks can blow out a flex/grid
-- column's min-content width and break the whole row it's in.
--
-- Delivery status is now tracked as real columns; the UI renders it as a
-- small separate badge instead of splicing it into the message body.
-- ============================================================================

alter table messages
  add column if not exists delivered boolean not null default true,
  add column if not exists delivery_error text;
