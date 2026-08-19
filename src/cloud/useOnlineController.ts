import { useCallback, useMemo, useState } from 'react';
import {
  generateLegalMovesFrom,
  legalMovesBetween,
  royalSquares,
  type GameState,
  type Move,
  type Square,
} from '../engine';
import type { GameAction } from '../ai/actions';

/**
 * Board interaction for an ONLINE game.
 *
 * Implements the same controller surface the `Board` component already
 * consumes for local play, but instead of applying moves it wraps the chosen
 * `Move` as a `GameAction` and hands it to the caller (who submits it to the
 * server). Selection is restricted to the viewer's own pieces on their own
 * turn — the opponent's pieces are display-only.
 *
 * Spells are absent because online v1 is classic chess; `spellTargets` stays
 * empty and `casting` null to satisfy the shared interface.
 */

export function useOnlineController(
  game: GameState,
  myColor: 'white' | 'black' | null,
  canAct: boolean,
  onAction: (action: GameAction) => void,
) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{
    from: Square;
    to: Square;
    options: readonly Move[];
  } | null>(null);

  const movesBySquare = useMemo(() => {
    const map = new Map<Square, Move[]>();
    if (selected === null || !canAct) return map;
    for (const move of generateLegalMovesFrom(game, selected)) {
      const existing = map.get(move.to);
      if (existing) existing.push(move);
      else map.set(move.to, [move]);
    }
    return map;
  }, [game, selected, canAct]);

  const lastMove = game.history.at(-1)?.move ?? null;

  const checkSquare = useMemo(() => {
    if (game.status !== 'check' && game.status !== 'checkmate') return null;
    return royalSquares(game.board, game.turn)[0] ?? null;
  }, [game]);

  const play = useCallback(
    (move: Move) => {
      setSelected(null);
      setPendingChoice(null);
      onAction({ kind: 'move', move });
    },
    [onAction],
  );

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!canAct) return false;
      const candidates = legalMovesBetween(game, from, to);
      const first = candidates[0];
      if (!first) return false;
      if (candidates.length > 1) {
        setSelected(from);
        setPendingChoice({ from, to, options: candidates });
        return true;
      }
      play(first);
      return true;
    },
    [game, canAct, play],
  );

  const selectSquare = useCallback(
    (square: Square) => {
      if (!canAct || pendingChoice) return;
      if (selected !== null && selected !== square && tryMove(selected, square)) return;

      const piece = game.board[square];
      const selectable = piece !== null && piece !== undefined && piece.color === myColor;
      setSelected(selectable && square !== selected ? square : null);
    },
    [game, canAct, pendingChoice, selected, tryMove, myColor],
  );

  const chooseMove = useCallback(
    (move: Move) => {
      if (pendingChoice) play(move);
    },
    [pendingChoice, play],
  );

  const cancelChoice = useCallback(() => {
    setPendingChoice(null);
    setSelected(null);
  }, []);

  return {
    game,
    selected,
    pendingChoice,
    casting: null,
    movesBySquare,
    lastMove,
    checkSquare,
    spellTargets: useMemo(() => new Set<Square>(), []),
    selectSquare,
    tryMove,
    chooseMove,
    cancelChoice,
  };
}
