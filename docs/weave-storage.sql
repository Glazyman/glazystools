-- Weave — card attachments.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Files live in Storage, not in the board's jsonb: a base64 photo inside the
-- document would be re-uploaded on every autosave and would blow the row up.
-- The card keeps a URL.

insert into storage.buckets (id, name, public)
values ('weave', 'weave', true)
on conflict (id) do nothing;

-- Public-read, like the rest of this single-user tool: the site sits behind the
-- password gate, and object names carry a uuid, so a URL is unguessable in
-- practice. Not a secret store — don't put anything sensitive on a card.
drop policy if exists "anon read weave" on storage.objects;
create policy "anon read weave" on storage.objects
  for select to anon using (bucket_id = 'weave');

drop policy if exists "anon write weave" on storage.objects;
create policy "anon write weave" on storage.objects
  for insert to anon with check (bucket_id = 'weave');

drop policy if exists "anon delete weave" on storage.objects;
create policy "anon delete weave" on storage.objects
  for delete to anon using (bucket_id = 'weave');
