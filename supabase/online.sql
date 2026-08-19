-- Chess 2 — online matchmaking + games
--
-- Run AFTER schema.sql, in the dashboard SQL editor. Idempotent.
--
-- Model: an online game is an APPEND-ONLY ACTION LOG. The server never runs
-- the chess engine; it enforces membership, turn order and append position,
-- while every client replays the log through the deterministic engine and
-- validates each action's legality. An illegal append (a modified client)
-- is therefore detected by the opponent rather than silently accepted.
-- All writes go through SECURITY DEFINER functions — there are deliberately
-- NO direct insert/update policies on online_games.

-- ------------------------------------------------------------------- queue

create table if not exists public.matchmaking_queue (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Player',
  time_control text not null default 'unlimited',
  created_at   timestamptz not null default now()
);

alter table public.matchmaking_queue enable row level security;

drop policy if exists "queue is self-service" on public.matchmaking_queue;
create policy "queue is self-service" on public.matchmaking_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------- games

create table if not exists public.online_games (
  id           uuid primary key default gen_random_uuid(),
  white_id     uuid not null references auth.users on delete cascade,
  black_id     uuid not null references auth.users on delete cascade,
  white_name   text not null default 'White',
  black_name   text not null default 'Black',
  status       text not null default 'active' check (status in ('active', 'finished')),
  -- Whose turn the server believes it is. Maintained from submissions; the
  -- clients' engine replay is the deeper truth (see submit_online_action).
  turn         text not null default 'white' check (turn in ('white', 'black')),
  actions      jsonb not null default '[]'::jsonb,
  winner       text check (winner in ('white', 'black', 'draw')),
  reason       text,
  time_control text not null default 'unlimited',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.online_games enable row level security;

drop policy if exists "players see their games" on public.online_games;
create policy "players see their games" on public.online_games
  for select using (auth.uid() = white_id or auth.uid() = black_id);

create index if not exists online_games_white_idx on public.online_games (white_id, status);
create index if not exists online_games_black_idx on public.online_games (black_id, status);

-- Realtime: clients subscribe to UPDATEs on their game row. Adding the table
-- to the publication is guarded because re-adding raises.
do $$
begin
  alter publication supabase_realtime add table public.online_games;
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------- find / queue match
-- One atomic call: take the oldest compatible opponent from the queue, or
-- join the queue. SKIP LOCKED makes two simultaneous callers pair safely
-- instead of both grabbing the same row.

create or replace function public.find_online_match(
  p_time_control text,
  p_display_name text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_opponent record;
  v_game uuid;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  -- Never match yourself; refresh any stale queue entry with current details.
  delete from matchmaking_queue where user_id = v_me;

  select user_id, display_name into v_opponent
  from matchmaking_queue
  where time_control = p_time_control and user_id <> v_me
  order by created_at
  limit 1
  for update skip locked;

  if v_opponent.user_id is not null then
    delete from matchmaking_queue where user_id = v_opponent.user_id;
    -- The waiting player takes White: they were first.
    insert into online_games (white_id, black_id, white_name, black_name, time_control)
    values (v_opponent.user_id, v_me, v_opponent.display_name, coalesce(p_display_name, 'Player'), p_time_control)
    returning id into v_game;
    return v_game;
  end if;

  insert into matchmaking_queue (user_id, display_name, time_control)
  values (v_me, coalesce(p_display_name, 'Player'), p_time_control);
  return null;
end;
$$;

-- The queued player discovers their pairing by polling this (or realtime).
create or replace function public.my_active_online_game()
returns uuid
language sql
security definer set search_path = public
as $$
  select id from online_games
  where status = 'active' and (white_id = auth.uid() or black_id = auth.uid())
  order by created_at desc
  limit 1;
$$;

create or replace function public.cancel_matchmaking()
returns void
language sql
security definer set search_path = public
as $$
  delete from matchmaking_queue where user_id = auth.uid();
$$;

-- ---------------------------------------------------------- submit an action
-- Appends one action with three checks: the caller is the player whose turn
-- it is, the game is live, and the log is exactly the length the caller saw
-- (optimistic concurrency — a stale client gets an error, refetches, and
-- retries). p_next_turn is the caller's engine-derived side to move, which a
-- bonus phase can keep unchanged; the opponent's client re-validates every
-- action, so lying here only voids the game in the opponent's view.

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
  if v_game.status <> 'active' then raise exception 'game is finished'; end if;

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

-- ------------------------------------------------------------- finish a game
-- Either player may record the result their engine derived (checkmate, draw)
-- or resign. Resignation is the ONLY finish that may name the caller's
-- opponent as winner regardless of position.

create or replace function public.finish_online_game(
  p_game uuid,
  p_winner text,
  p_reason text
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_game record;
begin
  select * into v_game from online_games where id = p_game for update;
  if v_game.id is null then raise exception 'no such game'; end if;
  if v_me <> v_game.white_id and v_me <> v_game.black_id then
    raise exception 'not a player in this game';
  end if;
  if v_game.status = 'finished' then return; end if;
  if p_winner is not null and p_winner not in ('white', 'black', 'draw') then
    raise exception 'bad winner';
  end if;

  update online_games
  set status = 'finished', winner = p_winner, reason = coalesce(p_reason, 'finished'),
      updated_at = now()
  where id = p_game;
end;
$$;

-- ------------------------------------------------------------------ grants

grant select, insert, delete on public.matchmaking_queue to authenticated;
grant select on public.online_games to authenticated;
grant execute on function public.find_online_match(text, text) to authenticated;
grant execute on function public.my_active_online_game() to authenticated;
grant execute on function public.cancel_matchmaking() to authenticated;
grant execute on function public.submit_online_action(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.finish_online_game(uuid, text, text) to authenticated;
