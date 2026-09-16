-- ============================================================================
-- Schela — real email threading (In-Reply-To / References)
-- Run after 0019_whatsapp_delivery_status.sql.
--
-- Root cause of "escalation starts a new thread": no outbound email set the
-- In-Reply-To / References headers mail clients actually thread on. Gmail,
-- Outlook, and Apple Mail all key off these RFC Message-ID headers first —
-- subject text is only a fallback for very old/broken clients. Since every
-- send path in Schela also used a DIFFERENT subject line ("Rescheduling
-- your interview", "Interview reminder", "Your interview has been
-- cancelled"...), even that fallback wasn't reliable. This affects every
-- email flow, not only escalation — escalation was just the one tested.
--
-- Same mechanism as 0019's whatsapp_message_id: store the real Message-ID
-- for every email in a conversation (inbound AND outbound) so each new send
-- can reference the thread's actual header chain.
-- ============================================================================

alter table messages
  add column if not exists email_message_id text;

create index if not exists messages_email_message_id_idx
  on messages(email_message_id) where email_message_id is not null;

-- Looked up on every outbound email send to build In-Reply-To / References.
create index if not exists messages_conversation_email_chain_idx
  on messages(conversation_id, created_at) where channel = 'em';
