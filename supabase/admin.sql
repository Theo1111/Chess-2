-- Chess 2 — admin accounts and the published content config
--
-- Run this once in your project's SQL editor (Supabase dashboard → SQL →
-- New query → paste → Run), after `schema.sql`. It is idempotent: re-running
-- is safe.
--
-- Two pieces:
--   1. `admins`       — who may change the game's content config.
--   2. `content_flags` — which pieces and cards are currently draftable.
--
-- Security model: content flags are PUBLIC to read (every client, signed in
-- or not, must see the same catalog) and writable only by an admin. Admin
-- rights live in their own table with NO insert/update/delete policy at all,
-- so they can only be granted here, with the service role — a player cannot
-- promote themselves by writing to a row they own.

-- ------------------------------------------------------------------ admins

create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- A client may only ask whether IT is an admin; the list is not public.
drop policy if exists "admins may read their own grant" on public.admins;
create policy "admins may read their own grant" on public.admins
  for select using (auth.uid() = user_id);

grant select on public.admins to authenticated;

-- Used by the content-flag policies below. SECURITY DEFINER so the check
-- does not itself depend on the caller being able to read `admins`.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = uid);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to anon, authenticated;

-- ----------------------------------------------------------- content_flags
-- One row per piece or card the admin has an opinion about. A missing row
-- means "available" — the app ships with everything on, and the table only
-- ever records deviations from that.

create table if not exists public.content_flags (
  kind       text not null check (kind in ('piece', 'card')),
  item_id    text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  primary key (kind, item_id)
);

alter table public.content_flags enable row level security;

-- Everyone reads the catalog config, including signed-out local players.
drop policy if exists "content flags are public" on public.content_flags;
create policy "content flags are public" on public.content_flags
  for select using (true);

drop policy if exists "only admins change content flags" on public.content_flags;
create policy "only admins change content flags" on public.content_flags
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.content_flags to anon, authenticated;
grant insert, update, delete on public.content_flags to authenticated;

-- --------------------------------------------------------- granting admins
-- The account must already exist (it is created by signing up in the app).
-- To promote someone else, change the address and re-run just this block.

insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('wagtrack@gmail.com')
on conflict (user_id) do nothing;

-- To revoke:
--   delete from public.admins
--   where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
