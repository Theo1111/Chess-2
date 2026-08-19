-- Chess 2 — Supabase schema
--
-- Run this once in your project's SQL editor (Supabase dashboard → SQL →
-- New query → paste → Run). It is idempotent: re-running is safe.
--
-- Security model: every table is row-level-secured and every policy is
-- scoped to `auth.uid()`, so a signed-in player can only ever read or write
-- their OWN rows — even though the anon key is public in the browser. There
-- is deliberately no policy granting cross-user reads.

-- ---------------------------------------------------------------- profiles
-- One row per account, created automatically on sign-up by the trigger below.

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Player',
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are self-service" on public.profiles;
create policy "profiles are self-service" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Give every new auth user a profile without a round trip from the client.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ saved_armies
-- A drafted army (pieces + placement + card decks) kept for reuse. The roster
-- is stored as JSON so new pieces, cards and rules need no migration here.

create table if not exists public.saved_armies (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  roster     jsonb not null,
  -- Denormalised for cheap listing and for spotting armies built under
  -- older gameplay rules (see the balance lab's content fingerprint).
  points     integer not null default 0,
  content_fingerprint text,
  created_at timestamptz not null default now()
);

alter table public.saved_armies enable row level security;

drop policy if exists "armies are self-service" on public.saved_armies;
create policy "armies are self-service" on public.saved_armies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists saved_armies_user_created_idx
  on public.saved_armies (user_id, created_at desc);

-- ----------------------------------------------------------------- matches
-- A finished game. `moves` holds the SAN list and `start_fen` the opening
-- position, which is everything the engine needs to replay the game.

create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  mode         text not null check (mode in ('classic', 'custom')),
  time_control text not null default 'unlimited',
  winner       text check (winner in ('white', 'black', 'draw')),
  reason       text not null,
  plies        integer not null default 0,
  moves        jsonb not null default '[]'::jsonb,
  start_fen    text,
  final_fen    text,
  white_army   jsonb,
  black_army   jsonb,
  content_fingerprint text,
  played_at    timestamptz not null default now()
);

alter table public.matches enable row level security;

drop policy if exists "matches are self-service" on public.matches;
create policy "matches are self-service" on public.matches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists matches_user_played_idx
  on public.matches (user_id, played_at desc);

-- ------------------------------------------------------------------ grants
-- RLS decides WHICH ROWS a request may touch; Postgres grants decide whether
-- the role may touch the table at all. Tables created from the SQL editor do
-- not always inherit Supabase's default privileges, and without these the API
-- answers 401 "permission denied for table" even to a correctly signed-in
-- user, which looks exactly like broken auth.
--
-- Only `authenticated` is granted. `anon` (signed-out visitors) is given
-- nothing, so an anonymous request is refused before RLS is even consulted —
-- defence in depth rather than relying on the policies alone.

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on public.profiles, public.saved_armies, public.matches
  to authenticated;
