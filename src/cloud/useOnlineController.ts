import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  generateLegalMovesFrom,
  getSpellDefinition,
  legalMovesBetween,
  royalSquares,
  spellPrimaryTargets,
  spellSecondaryTargets,
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
 * Cards work exactly as they do locally, except that a finished cast is
 * submitted as a `spell` action instead of being applied: the server stores
 * it, and every client replays it through the same engine.
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
  const [casting, setCasting] = useState<{ spell: string; first: Square | null } | null>(null);

  // An armed card is only meaningful on this player's own turn; losing the
  // turn (or the game ending) disarms it.
  useEffect(() => {
    if (!canAct) setCasting(null);
  }, [canAct]);

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

  /** Squares the armed card may currently target. */
  const spellTargets = useMemo(() => {
    if (!casting || !canAct || myColor === null) return new Set<Square>();
    const list =
      casting.first === null
        ? spellPrimaryTargets(game, myColor, casting.spell)
        : spellSecondaryTargets(game, myColor, casting.spell, casting.first);
    return new Set(list);
  }, [game, casting, canAct, myColor]);

  const submit = useCallback(
    (action: GameAction) => {
      setSelected(null);
      setPendingChoice(null);
      setCasting(null);
      onAction(action);
    },
    [onAction],
  );

  const play = useCallback((move: Move) => submit({ kind: 'move', move }), [submit]);

  /** Arms (or disarms) a card. Untargeted cards are submitted immediately. */
  const selectSpell = useCallback(
    (spell: string) => {
      if (!canAct || myColor === null) return;
      if (game.phase !== 'main' || game.pawnOrder !== null) return;
      if (casting?.spell === spell) {
        setCasting(null);
        return;
      }
      if (!game.spells[myColor].available.includes(spell)) return;

      const definition = getSpellDefinition(spell);
      if (definition.targeting === 'none') {
        submit({ kind: 'spell', spell, targets: [], trap: definition.isTrap === true });
        return;
      }
      setSelected(null);
      setPendingChoice(null);
      setCasting({ spell, first: null });
    },
    [canAct, myColor, game, casting, submit],
  );

  const cancelSpell = useCallback(() => setCasting(null), []);

  /** Declines an optional bonus move (Duelist free move / Royal Order pawn). */
  const passBonus = useCallback(() => {
    if (!canAct) return;
    submit({ kind: 'pass' });
  }, [canAct, submit]);

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

      // An armed card swallows board clicks until it is cast or cancelled.
      if (casting) {
        if (!spellTargets.has(square)) return;
        const needsSecond =
          getSpellDefinition(casting.spell).targeting.includes('then') && casting.first === null;
        if (needsSecond) {
          setCasting({ spell: casting.spell, first: square });
          return;
        }
        const targets = casting.first === null ? [square] : [casting.first, square];
        submit({
          kind: 'spell',
          spell: casting.spell,
          targets,
          trap: getSpellDefinition(casting.spell).isTrap === true,
        });
        return;
      }

      if (selected !== null && selected !== square && tryMove(selected, square)) return;

      const piece = game.board[square];
      const selectable = piece !== null && piece !== undefined && piece.color === myColor;
      setSelected(selectable && square !== selected ? square : null);
    },
    [game, canAct, pendingChoice, selected, tryMove, myColor, casting, spellTargets, submit],
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
    casting,
    movesBySquare,
    lastMove,
    checkSquare,
    spellTargets,
    selectSquare,
    tryMove,
    chooseMove,
    cancelChoice,
    selectSpell,
    cancelSpell,
    passBonus,
  };
}
