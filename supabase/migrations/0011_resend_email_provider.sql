-- ============================================================================
-- Schela — switch the email provider from SendGrid to Resend
-- Run after 0010_withdrawn_notification_type.sql.
--
-- Resend replaces SendGrid because it has first-class INBOUND support: a
-- candidate replying to an interview email actually reaches Schela, rather
-- than email being a one-way channel that looks two-way in the UI.
--
-- Any org that had connected SendGrid keeps its row (nothing is destroyed),
-- but the row is renamed and disconnected so the recruiter is prompted to
-- paste a Resend key. Its old SendGrid key is cleared rather than silently
-- carried over to a provider that would reject it.
-- ============================================================================

update integrations
set
  id = 'resend',
  name = 'Resend Email',
  icon = 'mail',
  connected = false,
  account = null,
  config = null,
  last_synced = null
where id = 'sendgrid';
