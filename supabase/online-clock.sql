-- Chess 2 — the online match clock
--
-- Run AFTER online-custom.sql, in the dashboard SQL editor. Idempotent.
--
-- The clock is kept BY THE SERVER, for the same reason the drafting deadline
-- is: a paused tab, a throttled timer or a tampered client must never buy a
-- player extra time. Each side's remaining milliseconds live on the game row
-- and are charged from `now() - turn_started_at` every time an action is
-- appended. Clients count down for display only; the numbers they show are
-- always a projection of what the row already says.
--
-- Losing on time is therefore not something a client decides. Either player
-- may ASK (claim_online_timeout) — the server recomputes the elapsed time
-- itself and only ends the game if the flag has genuinely fallen.

-- ------------------------------------------------------------ new columns
-- Null milliseconds = an untimed game; both sides are seeded together, so
-- `white_ms is null` is the single test for "this game has no clock".

alter table public.online_games
  add column if not exists white_ms        integer,
  add column if not exists black_ms        integer,
  add column if not exists turn_started_at timestamptz;

-- Milliseconds per player for a time-control id. The ids are minute counts
-- ('5', '10', …) and 'unlimited', which is exactly what the client's
-- TIME_CONTROLS table holds — so a new minute-based control needs no change
-- here.
create or replace function public.time_control_ms(p_time_control text)
returns integer
language sql
immutable
as $$
  select case
    when p_time_control ~ '^[0-9]+$' then (p_time_control::integer) * 60000
    else null
  end;
$$;

-- Clients read this once to measure their own clock's offset, so a device
-- with a wrong system time still renders the right countdown.
create or replace function public.server_time()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- ------------------------------------------------------------- matchmaking
-- Unchanged except that a pairing now seeds both clocks. A drafting game's
-- clock does not start until both armies are in (see submit_online_army).

create or replace function public.find_online_match(
  p_time_control text,
  p_display_name text,
  p_mode text default 'custom'
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_opponent record;
  v_game uuid;
  v_status text;
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
    v_status := case when p_mode = 'custom' then 'drafting' else 'active' end;

    insert into online_games (
      white_id, black_id, white_name, black_name, time_control, mode, status,
      draft_deadline, white_ms, black_ms, turn_started_at
    )
    values (
      v_opponent.user_id, v_me, v_opponent.display_name, coalesce(p_display_name, 'Player'),
      p_time_control, p_mode, v_status,
      case when p_mode = 'custom' then now() + interval '60 seconds' else null end,
      time_control_ms(p_time_control),
      time_control_ms(p_time_control),
      case when v_status = 'active' then now() else null end
    )
    returning id into v_game;
    return v_game;
  end if;

  insert into matchmaking_queue (user_id, display_name, time_control, mode)
  values (v_me, coalesce(p_display_name, 'Player'), p_time_control, p_mode);
  return null;
end;
$$;

-- ------------------------------------------------------------- submit army
-- Unchanged except that White's clock starts the moment the board exists.

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
      -- Standard convention: White is already on the clock at move one.
      turn_started_at = case when v_status = 'active' then now() else turn_started_at end,
      updated_at = now()
  where id = p_game;

  return v_status;
end;
$$;

-- ------------------------------------------------------------ submit action
-- Now also the clock's ledger: the mover is charged for exactly the time they
-- held the board, and the next side's stamp begins. A bonus phase that keeps
-- the same player on turn keeps charging them, which is correct.
--
-- Returns the new ply, or -1 when the caller's flag had already fallen — in
-- which case the action is NOT recorded and the game is finished on time.
-- (Reporting that by raising would roll the finish back with it.)

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
  v_elapsed integer;
  v_left integer;
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

  -- Untimed game: append and go.
  if v_game.white_ms is null then
    update online_games
    set actions = actions || jsonb_build_array(p_action),
        turn = p_next_turn,
        updated_at = now()
    where id = p_game;
    return p_expected_ply + 1;
  end if;

  v_elapsed := greatest(
    0,
    floor(extract(epoch from (now() - coalesce(v_game.turn_started_at, now()))) * 1000)
  )::integer;
  v_left := greatest(
    0,
    (case v_my_color when 'white' then v_game.white_ms else v_game.black_ms end) - v_elapsed
  );

  if v_left <= 0 then
    update online_games
    set status = 'finished',
        winner = case v_my_color when 'white' then 'black' else 'white' end,
        reason = 'timeout',
        white_ms = case v_my_color when 'white' then 0 else v_game.white_ms end,
        black_ms = case v_my_color when 'black' then 0 else v_game.black_ms end,
        updated_at = now()
    where id = p_game;
    return -1;
  end if;

  update online_games
  set actions = actions || jsonb_build_array(p_action),
      turn = p_next_turn,
      white_ms = case v_my_color when 'white' then v_left else v_game.white_ms end,
      black_ms = case v_my_color when 'black' then v_left else v_game.black_ms end,
      turn_started_at = now(),
      updated_at = now()
  where id = p_game;

  return p_expected_ply + 1;
end;
$$;

-- ------------------------------------------------------------ claim a flag
-- A player whose opponent has run out asks for the win; the waiting player's
-- own client asks too. The server recomputes the elapsed time from its own
-- clock, so an early or forged claim simply answers 'active'.

create or replace function public.claim_online_timeout(p_game uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_game record;
  v_elapsed integer;
  v_left integer;
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if auth.uid() <> v_game.white_id and auth.uid() <> v_game.black_id then
    raise exception 'not a player in this game';
  end if;
  if v_game.status <> 'active' then return v_game.status; end if;
  if v_game.white_ms is null or v_game.turn_started_at is null then return 'active'; end if;

  v_elapsed := greatest(
    0,
    floor(extract(epoch from (now() - v_game.turn_started_at)) * 1000)
  )::integer;
  v_left := greatest(
    0,
    (case v_game.turn when 'white' then v_game.white_ms else v_game.black_ms end) - v_elapsed
  );

  if v_left > 0 then return 'active'; end if;

  update online_games
  set status = 'finished',
      winner = case v_game.turn when 'white' then 'black' else 'white' end,
      reason = 'timeout',
      white_ms = case v_game.turn when 'white' then 0 else v_game.white_ms end,
      black_ms = case v_game.turn when 'black' then 0 else v_game.black_ms end,
      updated_at = now()
  where id = p_game;

  return 'finished';
end;
$$;

-- ------------------------------------------------------- retire the old RPC
-- online.sql's two-argument version predates game modes. Every client sends
-- p_mode now, so the overload is dead — and leaving it in place lets a stale
-- client pair players into a game with no armies at all.

drop function if exists public.find_online_match(text, text);

-- ------------------------------------------------------------------ grants

grant execute on function public.time_control_ms(text) to anon, authenticated;
grant execute on function public.server_time() to anon, authenticated;
grant execute on function public.find_online_match(text, text, text) to authenticated;
grant execute on function public.submit_online_army(uuid, jsonb) to authenticated;
grant execute on function public.submit_online_action(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.claim_online_timeout(uuid) to authenticated;
