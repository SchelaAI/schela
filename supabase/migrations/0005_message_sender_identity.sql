-- ============================================================================
-- Schela — message sender identity
-- Run after 0004_message_delivery_status.sql.
--
-- Every outbound message was indistinguishable "schela" — no way to tell
-- whether it was the AI auto-replying or a human recruiter typing in the
-- Conversations composer. Chat UIs (and recruiters skimming a thread) need
-- to know which. sender_kind captures who actually authored it; sender_name
-- carries the AI's own label ("Schela") or the real recruiter's name.
-- ============================================================================

alter table messages
  add column if not exists sender_kind text not null default 'ai'
    check (sender_kind in ('ai', 'human', 'candidate', 'system')),
  add column if not exists sender_name text;

-- Backfill: every existing inbound message from a candidate is obviously
-- 'candidate', not the 'ai' default above.
update messages set sender_kind = 'candidate' where from_role = 'candidate';
