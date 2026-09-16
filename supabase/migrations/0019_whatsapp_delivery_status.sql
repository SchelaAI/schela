-- ============================================================================
-- Schela — real WhatsApp delivery status, not just send-acceptance
-- Run after 0018_noreply_email_followup.sql.
--
-- Root cause of "shows delivered, candidate never received it": Meta's send
-- API is asynchronous. The synchronous response only means "accepted into
-- Meta's queue" — actual delivery (or failure: wrong number, not on
-- WhatsApp, blocked, etc.) is reported LATER via a separate status webhook
-- referencing the message by its WhatsApp message ID (wamid).
--
-- Two things were missing, so Schela could never learn about a failure after
-- the fact:
--   1. That wamid was never stored anywhere once a message sent.
--   2. The webhook explicitly skipped status payloads without looking at them.
-- Both are fixed alongside this migration.
-- ============================================================================

alter table messages
  add column if not exists whatsapp_message_id text;

-- Looked up by the webhook every time a status callback arrives.
create index if not exists messages_whatsapp_message_id_idx
  on messages(whatsapp_message_id) where whatsapp_message_id is not null;
