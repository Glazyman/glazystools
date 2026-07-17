-- Weave — board storage.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- A board is stored as a single jsonb document rather than normalised
-- cards/edges tables. It's a single-user tool and a board is always read and
-- written whole, so a document keeps saves atomic and avoids a per-node sync
-- protocol we'd get no benefit from.

create table if not exists public.weave_boards (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title      text not null default 'Untitled board',
  doc        jsonb not null default
             '{"cards":[],"edges":[],"utterances":[],"questions":[]}'::jsonb
);

-- The board list orders by most-recently-touched.
create index if not exists weave_boards_updated_at_idx
  on public.weave_boards (updated_at desc);

alter table public.weave_boards enable row level security;

-- The whole site sits behind a password gate (proxy.ts + the glazy_auth cookie)
-- and has exactly one user, so the anon key gets full access here — the same
-- posture already used by grab_it_runs.
drop policy if exists "anon full access" on public.weave_boards;
create policy "anon full access" on public.weave_boards
  for all to anon using (true) with check (true);
