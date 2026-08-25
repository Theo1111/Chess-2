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

-- ------------------------------------------------------------ secret cards
-- Some cards are not in the public catalog (today: Ruler's Authority, which
-- is a joke card that wins on the spot). The client hides them from anyone
-- without an admin grant, but hiding is not enforcing: this is the check that
-- actually stops a modified client from bringing one into an ONLINE game.
--
-- Local hot-seat games are not covered and cannot be — there is no server in
-- that loop at all.

create or replace function public.roster_has_secret_card(p_roster jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (p_roster -> 'spellIds') ?| array['rulers-authority']
      or (p_roster -> 'trapIds') ?| array['rulers-authority'],
    false
  );
$$;

grant execute on function public.roster_has_secret_card(jsonb) to authenticated;

-- Wraps the army submission from online-custom.sql / online-clock.sql: same
-- behaviour, plus the secret-card check. Run this file AFTER those two.
create or replace function public.submit_online_army(
  p_game uuid,
  p_roster jsonb
) returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_game record;
  v_white jsonb;
  v_black jsonb;
  v_status text;
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if v_game.status = 'cancelled' then return 'cancelled'; end if;
  if v_game.status <> 'drafting' then raise exception 'not drafting'; end if;
  if v_me <> v_game.white_id and v_me <> v_game.black_id then
    raise exception 'not a player in this game';
  end if;

  -- The gate itself. An ordinary account cannot field the secret card.
  if roster_has_secret_card(p_roster) and not public.is_admin() then
    raise exception 'that card is not in the catalog';
  end if;

  if v_game.draft_deadline is not null and now() > v_game.draft_deadline then
    update online_games
    set status = 'cancelled', reason = 'draft timed out', updated_at = now()
    where id = p_game;
    return 'cancelled';
  end if;

  v_white := case when v_me = v_game.white_id then p_roster else v_game.white_army end;
  v_black := case when v_me = v_game.black_id then p_roster else v_game.black_army end;
  v_status := case when v_white is not null and v_black is not null then 'active' else 'drafting' end;

  update online_games
  set white_army = v_white,
      black_army = v_black,
      status = v_status,
      turn_started_at = case when v_status = 'active' then now() else turn_started_at end,
      updated_at = now()
  where id = p_game;

  return v_status;
end;
$$;

grant execute on function public.submit_online_army(uuid, jsonb) to authenticated;

-- --------------------------------------------------------- granting admins
-- The account must already exist (it is created by signing up in the app).
-- To promote someone else, change the address and re-run just this block.

insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('wagtrack@gmail.com')
on conflict (user_id) do nothing;

-- To revoke:
--   delete from public.admins
--   where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
