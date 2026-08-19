import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '../engine';
import type { GameAction } from '../ai/actions';
import {
  fetchOnlineGame,
  finishOnlineGame,
  submitOnlineAction,
  subscribeToOnlineGame,
  type OnlineGameRow,
} from './online';
import { replayOnlineActions, nextTurnAfter, replayOutcome } from './onlineReplay';
import type { AccountUser } from './auth';

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
  readonly submit: (action: GameAction) => Promise<void>;
  readonly resign: () => Promise<void>;
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

  const replay = useMemo(() => (row ? replayOnlineActions(row.actions) : null), [row]);

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

  const resign = useCallback(async () => {
    if (!row || myColor === null || row.status !== 'active') return;
    const winner: Color = myColor === 'white' ? 'black' : 'white';
    const result = await finishOnlineGame(row.id, winner, 'resignation');
    if (result.error) setError(result.error);
    await refresh();
  }, [row, myColor, refresh]);

  return { row, replay, myColor, canAct, error, submit, resign };
}
