-- ============================================================================
-- Schela — real integration connectors
-- Run after 0005_message_sender_identity.sql.
--
-- Previously the Integrations page was pure decoration: rows seeded once at
-- onboarding (silently skipped on failure, which is why some orgs show
-- nothing at all), a permanently disabled "Not yet available" button, and
-- WhatsApp secretly only configurable via server env vars with no UI path.
--
-- `config` holds each integration's own credentials/tokens as JSON — never
-- returned to the browser as-is (see lib/store.ts listIntegrations, which
-- strips it down to a masked `account` string before it leaves the server).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ROOT CAUSE FIX: integrations.id was declared `primary key` on its own,
-- making ids like 'whatsapp'/'gcal' globally unique across EVERY org in the
-- deployment, not per-org. Only the very first org ever created could
-- successfully seed its integration rows — every other org's onboarding
-- insert silently violated the primary key and failed (the insert was
-- deliberately non-fatal), leaving that org with zero integration rows
-- forever. This is why the Integrations page can show completely empty.
-- ---------------------------------------------------------------------------
alter table integrations drop constraint integrations_pkey;
alter table integrations add primary key (id, org_id);

alter table integrations
  add column if not exists config jsonb;

comment on column integrations.config is
  'Provider-specific credentials/tokens (API keys, OAuth tokens). Server-side only — never sent to the client.';
