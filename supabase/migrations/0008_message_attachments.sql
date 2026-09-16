-- ============================================================================
-- Schela — message attachments (files, images) on conversations
-- Run after 0007_meeting_links.sql.
--
-- The composer's paperclip and emoji buttons were decorative — no handlers,
-- no storage, no send path. Emoji need no storage (they're just unicode in
-- `text`), but files do: these columns record what was attached, and the
-- storage bucket below holds the actual bytes.
--
-- The bucket is PUBLIC on purpose: Meta's WhatsApp media API fetches an
-- attachment by URL from their own servers, so the link has to be reachable
-- without a Supabase session. Object names include a random segment so they
-- aren't guessable by enumeration.
-- ============================================================================

alter table messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,   -- MIME type, e.g. image/jpeg
  add column if not exists attachment_size integer; -- bytes

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- Uploads are performed server-side with the service role (see lib/store.ts),
-- which bypasses RLS. This policy only needs to allow public READ so Meta and
-- the recruiter's browser can fetch the file.
drop policy if exists "public read attachments" on storage.objects;
create policy "public read attachments" on storage.objects
  for select using (bucket_id = 'attachments');
