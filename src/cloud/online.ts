/**
 * Online play — client calls for matchmaking and the shared action log.
 *
 * Same contract as the rest of `src/cloud`: plain result objects, never
 * throws, unconfigured builds answer with a clear error string. All writes
 * go through the SECURITY DEFINER functions in `supabase/online.sql`; there
 * is no direct table write anywhere in the client.
 */

import type { Color } from '../engine';
import type { Roster } from '../roster';
import type { GameAction } from '../ai/actions';
import { CLOUD_SETUP_HINT, getSupabase } from './supabaseClient';

export interface OnlineGameRow {
  readonly id: string;
  readonly white_id: string;
  readonly black_id: string;
  readonly white_name: string;
  readonly black_name: string;
  readonly status: 'drafting' | 'active' | 'finished' | 'cancelled';
  /** 'custom' for every game this client starts; older rows may say 'classic'. */
  readonly mode: string;
  /** Null until that player submits during the drafting phase. */
  readonly white_army: Roster | null;
  readonly black_army: Roster | null;
  /** When the drafting phase expires (custom mode only). */
  readonly draft_deadline: string | null;
  readonly turn: Color;
  readonly actions: readonly GameAction[];
  readonly winner: Color | 'draw' | null;
  readonly reason: string | null;
  readonly time_control: string;
  /**
   * Milliseconds left on each clock as of `turn_started_at`, or null in an
   * untimed game. The server is the only writer: it charges the mover on
   * every action, so these are facts, not a client's opinion.
   */
  readonly white_ms: number | null;
  readonly black_ms: number | null;
  /** When the side to move's clock started running. */
  readonly turn_started_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface Result {
  readonly error: string | null;
}

const NOT_CONFIGURED: Result = { error: CLOUD_SETUP_HINT };

/**
 * PostgREST answers "could not find the function … in the schema cache" when
 * a SECURITY DEFINER function the client calls does not exist — which in
 * practice always means one of `supabase/*.sql` has not been run against this
 * project. Say that, rather than leaving a developer to decode it.
 */
const MIGRATION_HINT =
  'This Supabase project is missing an online-play migration. Run supabase/online-custom.sql, ' +
  'online-clock.sql and admin.sql (in that order) in the SQL editor.';

export function describeOnlineError(error: string | null): string | null {
  if (error === null) return null;
  return /schema cache/i.test(error) ? `${error}. ${MIGRATION_HINT}` : error;
}

/**
 * Atomically pair with the oldest waiting player on the same time control,
 * or join the queue. `gameId` is null while queued. Every match is a
 * custom-army game, so the mode is fixed here rather than chosen.
 */
export async function findOnlineMatch(
  timeControl: string,
  displayName: string,
): Promise<Result & { gameId: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, gameId: null };

  const { data, error } = await supabase.rpc('find_online_match', {
    p_time_control: timeControl,
    p_display_name: displayName,
    p_mode: 'custom',
  });
  return { gameId: (data as string | null) ?? null, error: error?.message ?? null };
}

/** The caller's most recent live game — how a queued player finds a pairing. */
export async function myActiveOnlineGame(): Promise<Result & { gameId: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, gameId: null };

  const { data, error } = await supabase.rpc('my_active_online_game');
  return { gameId: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function cancelMatchmaking(): Promise<Result> {
  const supabase = await getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('cancel_matchmaking');
  return { error: error?.message ?? null };
}

export async function fetchOnlineGame(
  gameId: string,
): Promise<Result & { game: OnlineGameRow | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, game: null };

  const { data, error } = await supabase
    .from('online_games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();
  return { game: (data as OnlineGameRow | null) ?? null, error: error?.message ?? null };
}

/**
 * Append one action at position `expectedPly`. The server rejects stale
 * appends ("out of date") and turn violations; callers refetch and retry.
 *
 * `timedOut` means the caller's flag had already fallen when the action
 * arrived: it was not recorded and the game is now finished on time.
 */
export async function submitOnlineAction(
  gameId: string,
  expectedPly: number,
  action: GameAction,
  nextTurn: Color,
): Promise<Result & { timedOut: boolean }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, timedOut: false };

  const { data, error } = await supabase.rpc('submit_online_action', {
    p_game: gameId,
    p_expected_ply: expectedPly,
    p_action: action,
    p_next_turn: nextTurn,
  });
  return { timedOut: data === -1, error: error?.message ?? null };
}

/**
 * Ask the server to end a game on time. It recomputes the elapsed time from
 * its own clock and only acts if the flag has genuinely fallen, so both
 * clients may safely race to call it. Returns the game's status afterwards.
 */
export async function claimOnlineTimeout(
  gameId: string,
): Promise<Result & { status: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, status: null };

  const { data, error } = await supabase.rpc('claim_online_timeout', { p_game: gameId });
  return { status: (data as string | null) ?? null, error: error?.message ?? null };
}

/** The server's own wall clock, for correcting a device with a wrong one. */
export async function fetchServerTime(): Promise<number | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('server_time');
  if (error || typeof data !== 'string') return null;
  const parsed = Date.parse(data);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function finishOnlineGame(
  gameId: string,
  winner: Color | 'draw' | null,
  reason: string,
): Promise<Result> {
  const supabase = await getSupabase();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.rpc('finish_online_game', {
    p_game: gameId,
    p_winner: winner,
    p_reason: reason,
  });
  return { error: error?.message ?? null };
}

/**
 * Realtime updates for one game row. Returns an unsubscribe function.
 * Callers should keep a poll fallback: realtime can be disabled per project
 * and websockets drop silently on bad networks.
 */
export function subscribeToOnlineGame(
  gameId: string,
  onRow: (row: OnlineGameRow) => void,
): () => void {
  let cleanup: (() => void) | null = null;
  let cancelled = false;

  void getSupabase().then((supabase) => {
    if (!supabase || cancelled) return;
    const channel = supabase
      .channel(`online-game-${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'online_games', filter: `id=eq.${gameId}` },
        (payload) => onRow(payload.new as OnlineGameRow),
      )
      .subscribe();
    cleanup = () => void supabase.removeChannel(channel);
  });

  return () => {
    cancelled = true;
    cleanup?.();
  };
}

/**
 * Submit this player's army during the drafting phase. Returns the game's
 * new status: 'active' once both armies are in, 'drafting' while waiting,
 * or 'cancelled' if the server's deadline had already passed.
 */
export async function submitOnlineArmy(
  gameId: string,
  roster: Roster,
): Promise<Result & { status: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, status: null };

  const { data, error } = await supabase.rpc('submit_online_army', {
    p_game: gameId,
    p_roster: roster,
  });
  return { status: (data as string | null) ?? null, error: error?.message ?? null };
}

/**
 * Ask the server to cancel a draft whose deadline has passed. Safe to call
 * speculatively: it only acts once now() is genuinely past the deadline.
 */
export async function expireOnlineDraft(
  gameId: string,
): Promise<Result & { status: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NOT_CONFIGURED, status: null };

  const { data, error } = await supabase.rpc('expire_online_draft', { p_game: gameId });
  return { status: (data as string | null) ?? null, error: error?.message ?? null };
}
