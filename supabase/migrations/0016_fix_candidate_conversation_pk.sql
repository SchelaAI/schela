-- ============================================================================
-- Schela — fix globally-unique primary keys on candidates + conversations
-- Run after 0015_calendly_integration.sql.
--
-- Same class of bug as the integrations PK fixed in 0006, which existed here
-- too and was never checked for.
--
-- candidates.id is a TEXT key generated as initials + 2 random digits
-- ("MD61", "AS42") — only ~90 possible values per initial pair, and declared
-- `primary key` on its own, so that space is shared across EVERY org in the
-- deployment rather than per-org. conversations.id is derived from it
-- ("c-md61") and had the same problem.
--
-- Two real consequences:
--   1. Creating a candidate could collide with an unrelated org's candidate
--      and simply throw.
--   2. Worse and silent: the inbound webhooks upsert conversations with
--      onConflict "id". An inbound reply could therefore attach to a
--      conversation row owned by a DIFFERENT org's candidate holding the same
--      generated id — the message is stored, both webhooks return 200, and it
--      never appears in the recruiter's thread because it landed on someone
--      else's row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- messages needs its own org_id.
--
-- Without it, a foreign key from messages to a composite (id, org_id) key
-- would require a unique index on conversations(id) alone — which is exactly
-- the global-uniqueness constraint this migration exists to remove. Carrying
-- org_id makes the FK composite and lets RLS filter directly instead of
-- through a subquery.
-- ---------------------------------------------------------------------------
alter table messages add column if not exists org_id uuid references organizations(id) on delete cascade;

update messages m
set org_id = c.org_id
from conversations c
where m.conversation_id = c.id and m.org_id is null;

-- Any message whose conversation no longer exists can't be attributed to an
-- org and is unreachable in the UI regardless.
delete from messages where org_id is null;

alter table messages alter column org_id set not null;
create index if not exists messages_org_id_idx on messages(org_id);

-- ---------------------------------------------------------------------------
-- Drop FKs that reference the keys being replaced.
-- ---------------------------------------------------------------------------
alter table interviews    drop constraint interviews_candidate_id_fkey;
alter table conversations drop constraint conversations_candidate_id_fkey;
alter table messages      drop constraint messages_conversation_id_fkey;
alter table action_items  drop constraint action_items_candidate_id_fkey;
alter table action_items  drop constraint action_items_conversation_id_fkey;
alter table notifications drop constraint notifications_link_candidate_id_fkey;
alter table notifications drop constraint notifications_link_conversation_id_fkey;
alter table ai_decisions  drop constraint ai_decisions_conversation_id_fkey;

-- ---------------------------------------------------------------------------
-- New composite primary keys — id is now unique PER ORG, not globally.
-- ---------------------------------------------------------------------------
alter table candidates    drop constraint candidates_pkey;
alter table candidates    add primary key (id, org_id);

alter table conversations drop constraint conversations_pkey;
alter table conversations add primary key (id, org_id);

-- ---------------------------------------------------------------------------
-- Recreate every FK against (id, org_id). Each referencing table already
-- carries org_id, so including it additionally makes it impossible at the
-- database level for a row to reference another org's candidate/conversation.
-- ---------------------------------------------------------------------------
alter table interviews
  add constraint interviews_candidate_id_fkey
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade;

alter table conversations
  add constraint conversations_candidate_id_fkey
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade;

alter table messages
  add constraint messages_conversation_id_fkey
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade;

alter table action_items
  add constraint action_items_candidate_id_fkey
  foreign key (candidate_id, org_id) references candidates(id, org_id) on delete cascade;

alter table action_items
  add constraint action_items_conversation_id_fkey
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete cascade;

alter table notifications
  add constraint notifications_link_candidate_id_fkey
  foreign key (link_candidate_id, org_id) references candidates(id, org_id) on delete set null;

alter table notifications
  add constraint notifications_link_conversation_id_fkey
  foreign key (link_conversation_id, org_id) references conversations(id, org_id) on delete set null;

alter table ai_decisions
  add constraint ai_decisions_conversation_id_fkey
  foreign key (conversation_id, org_id) references conversations(id, org_id) on delete set null;

-- ---------------------------------------------------------------------------
-- messages RLS can now filter on org_id directly rather than subquerying
-- conversations on every row.
-- ---------------------------------------------------------------------------
drop policy if exists "org members can manage their messages" on messages;
create policy "org members can manage their messages" on messages
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
