-- Chess 2 — online custom armies + drafting phase
--
-- Run AFTER online.sql, in the dashboard SQL editor. Idempotent.
--
-- Adds a DRAFTING phase: a custom-army pairing starts unplayable, both
-- players have 60 seconds to submit an army, and the match is cancelled if
-- either fails to. The deadline is enforced server-side (now() vs
-- draft_deadline) so a client with a stopped clock, a paused tab or a
-- tampered timer cannot buy itself extra drafting time.

-- ------------------------------------------------------------ new columns

alter table public.online_games
  add column if not exists mode text not null default 'classic',
  add column if not exists white_army jsonb,
  add column if not exists black_army jsonb,
  add column if not exists draft_deadline timestamptz;

do $$
begin
  alter table public.online_games add constraint online_games_mode_check
    check (mode in ('classic', 'custom'));
exception when duplicate_object then null;
end $$;

-- Widen the status vocabulary: drafting → active → finished, plus cancelled.
alter table public.online_games drop constraint if exists online_games_status_check;
alter table public.online_games add constraint online_games_status_check
  check (status in ('drafting', 'active', 'finished', 'cancelled'));

alter table public.matchmaking_queue
  add column if not exists mode text not null default 'classic';

-- ---------------------------------------------------- matchmaking (by mode)
-- Players only pair with someone who chose the same mode AND time control.

create or replace function public.find_online_match(
  p_time_control text,
  p_display_name text,
  p_mode text default 'classic'
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_opponent record;
  v_game uuid;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if p_mode not in ('classic', 'custom') then raise exception 'bad mode'; end if;

  delete from matchmaking_queue where user_id = v_me;

  select user_id, display_name into v_opponent
  from matchmaking_queue
  where time_control = p_time_control and mode = p_mode and user_id <> v_me
  order by created_at
  limit 1
  for update skip locked;

  if v_opponent.user_id is not null then
    delete from matchmaking_queue where user_id = v_opponent.user_id;
    insert into online_games (
      white_id, black_id, white_name, black_name, time_control, mode, status, draft_deadline
    )
    values (
      v_opponent.user_id, v_me, v_opponent.display_name, coalesce(p_display_name, 'Player'),
      p_time_control, p_mode,
      case when p_mode = 'custom' then 'drafting' else 'active' end,
      case when p_mode = 'custom' then now() + interval '60 seconds' else null end
    )
    returning id into v_game;
    return v_game;
  end if;

  insert into matchmaking_queue (user_id, display_name, time_control, mode)
  values (v_me, coalesce(p_display_name, 'Player'), p_time_control, p_mode);
  return null;
end;
$$;

-- A drafting game is also "active" for the purpose of finding your pairing.
create or replace function public.my_active_online_game()
returns uuid
language sql
security definer set search_path = public
as $$
  select id from online_games
  where status in ('drafting', 'active')
    and (white_id = auth.uid() or black_id = auth.uid())
  order by created_at desc
  limit 1;
$$;

-- ------------------------------------------------------------ submit army
-- Stores the caller's roster and flips the game live once BOTH have landed.
-- Late submissions are refused: the deadline is read from the row, not from
-- anything the client sends.

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
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if v_game.status = 'cancelled' then return 'cancelled'; end if;
  if v_game.status <> 'drafting' then raise exception 'not drafting'; end if;
  if v_me <> v_game.white_id and v_me <> v_game.black_id then
    raise exception 'not a player in this game';
  end if;

  -- Server-side deadline: a slow or tampered client cannot sneak in late.
  if v_game.draft_deadline is not null and now() > v_game.draft_deadline then
    update online_games
    set status = 'cancelled', reason = 'draft timed out', updated_at = now()
    where id = p_game;
    return 'cancelled';
  end if;

  v_white := case when v_me = v_game.white_id then p_roster else v_game.white_army end;
  v_black := case when v_me = v_game.black_id then p_roster else v_game.black_army end;

  update online_games
  set white_army = v_white,
      black_army = v_black,
      status = case when v_white is not null and v_black is not null then 'active' else 'drafting' end,
      updated_at = now()
  where id = p_game;

  return case when v_white is not null and v_black is not null then 'active' else 'drafting' end;
end;
$$;

-- ------------------------------------------------------- expire the draft
-- Any client may ask; the server only acts once the deadline has genuinely
-- passed and an army is still missing.

create or replace function public.expire_online_draft(p_game uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_game record;
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if v_game.status <> 'drafting' then return v_game.status; end if;
  if auth.uid() <> v_game.white_id and auth.uid() <> v_game.black_id then
    raise exception 'not a player in this game';
  end if;

  if v_game.draft_deadline is not null and now() > v_game.draft_deadline then
    update online_games
    set status = 'cancelled', reason = 'draft timed out', updated_at = now()
    where id = p_game;
    return 'cancelled';
  end if;

  return 'drafting';
end;
$$;

-- A cancelled or drafting game must never accept moves.
create or replace function public.submit_online_action(
  p_game uuid,
  p_expected_ply integer,
  p_action jsonb,
  p_next_turn text
) returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_game record;
  v_my_color text;
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if v_game.status <> 'active' then raise exception 'game is not active'; end if;

  v_my_color := case
    when v_game.white_id = v_me then 'white'
    when v_game.black_id = v_me then 'black'
    else null
  end;
  if v_my_color is null then raise exception 'not a player in this game'; end if;
  if v_game.turn <> v_my_color then raise exception 'not your turn'; end if;
  if jsonb_array_length(v_game.actions) <> p_expected_ply then
    raise exception 'out of date: game has % actions, you expected %',
      jsonb_array_length(v_game.actions), p_expected_ply;
  end if;
  if p_next_turn not in ('white', 'black') then raise exception 'bad next turn'; end if;

  update online_games
  set actions = actions || jsonb_build_array(p_action),
      turn = p_next_turn,
      updated_at = now()
  where id = p_game;

  return p_expected_ply + 1;
end;
$$;

grant execute on function public.find_online_match(text, text, text) to authenticated;
grant execute on function public.submit_online_army(uuid, jsonb) to authenticated;
grant execute on function public.expire_online_draft(uuid) to authenticated;
