import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '../engine';
import type { GameAction } from '../ai/actions';
import type { Roster } from '../roster';
import {
  claimOnlineTimeout,
  expireOnlineDraft,
  fetchOnlineGame,
  finishOnlineGame,
  submitOnlineAction,
  submitOnlineArmy,
  subscribeToOnlineGame,
  type OnlineGameRow,
} from './online';
import { useOnlineClock } from './useOnlineClock';
import {
  createOnlineInitialState,
  replayOnlineActions,
  nextTurnAfter,
  replayOutcome,
} from './onlineReplay';
import type { AccountUser } from './auth';
import type { GameClock } from '../ui/useGameClock';

/**
 * One live online game as React state.
 *
 * The server row (action log + metadata) is the single source of truth;
 * board state is always DERIVED by replaying the log through the engine.
 * Updates arrive over realtime with a 4-second poll as fallback — realtime
 * can be disabled per project and websockets drop silently.
 */

const POLL_MS = 4000;

export interface OnlineGame {
  readonly row: OnlineGameRow | null;
  readonly replay: ReturnType<typeof replayOnlineActions> | null;
  /** Which side this account plays, or null while loading / not a player. */
  readonly myColor: Color | null;
  /** True when it is this account's turn in a live, valid game. */
  readonly canAct: boolean;
  readonly error: string | null;
  /** Both clocks, projected from the row the server maintains. */
  readonly clock: GameClock;
  readonly submit: (action: GameAction) => Promise<void>;
  readonly resign: () => Promise<void>;
  /** Drafting phase: seconds left, and whether this player has submitted. */
  readonly draftSecondsLeft: number | null;
  readonly armySubmitted: boolean;
  readonly submitArmy: (roster: Roster) => Promise<string | null>;
}

export function useOnlineGame(gameId: string, user: AccountUser | null): OnlineGame {
  const [row, setRow] = useState<OnlineGameRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic guard: an out-of-order realtime frame or slow poll response
  // must never overwrite a newer log with an older one.
  const bestPlyRef = useRef(-1);

  const acceptRow = useCallback((incoming: OnlineGameRow) => {
    const plies = incoming.actions.length + (incoming.status === 'finished' ? 0.5 : 0);
    if (plies < bestPlyRef.current) return;
    bestPlyRef.current = plies;
    setRow(incoming);
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchOnlineGame(gameId);
    if (result.game) acceptRow(result.game);
    else if (result.error) setError(result.error);
  }, [gameId, acceptRow]);

  useEffect(() => {
    bestPlyRef.current = -1;
    setRow(null);
    void refresh();
    const unsubscribe = subscribeToOnlineGame(gameId, acceptRow);
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [gameId, refresh, acceptRow]);

  // A game only has a position once both armies are in; until then there is
  // nothing to replay.
  const initialState = useMemo(
    () => (row ? createOnlineInitialState(row.white_army, row.black_army) : null),
    [row],
  );

  const replay = useMemo(
    () => (row && initialState ? replayOnlineActions(row.actions, initialState) : null),
    [row, initialState],
  );

  const myColor: Color | null = useMemo(() => {
    if (!row || !user) return null;
    if (row.white_id === user.id) return 'white';
    if (row.black_id === user.id) return 'black';
    return null;
  }, [row, user]);

  // Either client records the engine-derived result once the game ends —
  // the RPC is a no-op if the other player got there first.
  useEffect(() => {
    if (!row || !replay || row.status !== 'active' || !replay.valid) return;
    const outcome = replayOutcome(replay.state);
    if (outcome.over) {
      void finishOnlineGame(row.id, outcome.winner, outcome.reason).then(() => void refresh());
    }
  }, [row, replay, refresh]);

  const canAct = Boolean(
    row &&
      replay &&
      replay.valid &&
      row.status === 'active' &&
      myColor !== null &&
      replay.state.turn === myColor &&
      !replayOutcome(replay.state).over,
  );

  const submit = useCallback(
    async (action: GameAction) => {
      if (!row || !replay || !canAct) return;
      const after = nextTurnAfter(replay.state, action);
      const result = await submitOnlineAction(row.id, row.actions.length, action, after.turn);
      if (result.error) {
        setError(result.error);
        await refresh(); // stale log is the common cause — resync
        return;
      }
      if (result.timedOut) {
        // The flag had already fallen: the move was not recorded and the
        // server ended the game. The refreshed row says the rest.
        setError(null);
        await refresh();
        return;
      }
      setError(null);
      // Optimistic append so the mover sees their move instantly.
      acceptRow({
        ...row,
        actions: [...row.actions, action],
        turn: after.turn,
      });
    },
    [row, replay, canAct, refresh, acceptRow],
  );

  // --- drafting phase -----------------------------------------------------
  // The countdown is display only: the authoritative deadline lives in the
  // row and is re-checked by the server on every submit, so a paused tab or
  // a tampered client clock buys nobody extra time.
  const [now, setNow] = useState(() => Date.now());
  const drafting = row?.status === 'drafting';

  useEffect(() => {
    if (!drafting) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [drafting]);

  const draftSecondsLeft = useMemo(() => {
    if (!drafting || !row?.draft_deadline) return null;
    const left = new Date(row.draft_deadline).getTime() - now;
    return Math.max(0, Math.ceil(left / 1000));
  }, [drafting, row?.draft_deadline, now]);

  // Once the deadline passes, ask the server to cancel. It only acts if the
  // deadline has genuinely elapsed, so both clients may safely race here.
  useEffect(() => {
    if (!drafting || draftSecondsLeft === null || draftSecondsLeft > 0 || !row) return;
    void expireOnlineDraft(row.id).then(() => void refresh());
  }, [drafting, draftSecondsLeft, row, refresh]);

  const armySubmitted = Boolean(
    row && myColor && (myColor === 'white' ? row.white_army : row.black_army),
  );

  const submitArmy = useCallback(
    async (roster: Roster): Promise<string | null> => {
      if (!row) return null;
      const result = await submitOnlineArmy(row.id, roster);
      if (result.error) setError(result.error);
      await refresh();
      return result.status;
    },
    [row, refresh],
  );

  // --- the match clock ----------------------------------------------------
  // Display is derived from the row; ending a game on time is the server's
  // call, which this only ever asks for.
  const claimTimeout = useCallback(() => {
    if (!row || row.status !== 'active') return;
    void claimOnlineTimeout(row.id).then((result) => {
      if (result.error) setError(result.error);
      void refresh();
    });
  }, [row, refresh]);

  const clock = useOnlineClock(row, claimTimeout);

  const resign = useCallback(async () => {
    if (!row || myColor === null || row.status !== 'active') return;
    const winner: Color = myColor === 'white' ? 'black' : 'white';
    const result = await finishOnlineGame(row.id, winner, 'resignation');
    if (result.error) setError(result.error);
    await refresh();
  }, [row, myColor, refresh]);

  return {
    row,
    replay,
    myColor,
    canAct,
    error,
    clock,
    submit,
    resign,
    draftSecondsLeft,
    armySubmitted,
    submitArmy,
  };
}
