import { useCallback, useMemo, useState } from 'react';
import {
  applyMove,
  castSpell,
  createInitialState,
  generateLegalMovesFrom,
  getSpellDefinition,
  isGameOver,
  isInCheck,
  legalMovesBetween,
  royalSquares,
  skipBonusMove,
  spellPrimaryTargets,
  spellSecondaryTargets,
  type Color,
  type GameState,
  type Move,
  type PieceType,
  type Square,
} from '../engine';

/**
 * Interaction state around a game: what the player has picked up and whether a
 * choice between move variants is pending. Kept separate from `GameState` so
 * the engine's position stays purely about the rules.
 */
export interface GameSession {
  readonly game: GameState;
  readonly selected: Square | null;
  /**
   * Set when one square-to-square move has several meanings the player must
   * choose between: promotion piece, or an ability option (defect, return a
   * pawn). The UI renders a picker for whichever kind it is.
   */
  readonly pendingChoice: { from: Square; to: Square; options: readonly Move[] } | null;
  /** A spell card is armed and waiting for its target(s). */
  readonly casting: { readonly spell: string; readonly first: Square | null } | null;
}

const newSession = (game: GameState): GameSession => ({
  game,
  selected: null,
  pendingChoice: null,
  casting: null,
});

export function useChessGame(createGame: () => GameState = createInitialState) {
  const [session, setSession] = useState<GameSession>(() => newSession(createGame()));
  const { game, selected, pendingChoice, casting } = session;

  /** Legal moves for the currently selected piece, keyed by destination. */
  const movesBySquare = useMemo(() => {
    const map = new Map<Square, Move[]>();
    if (selected === null) return map;
    for (const move of generateLegalMovesFrom(game, selected)) {
      const existing = map.get(move.to);
      if (existing) existing.push(move);
      else map.set(move.to, [move]);
    }
    return map;
  }, [game, selected]);

  const lastMove = game.history.at(-1)?.move ?? null;

  /** The square to flag red: the king of whoever is currently in check. */
  const checkSquare = useMemo(() => {
    if (game.status !== 'check' && game.status !== 'checkmate') return null;
    return royalSquares(game.board, game.turn)[0] ?? null;
  }, [game]);

  /** Squares the armed spell may currently target. */
  const spellTargets = useMemo(() => {
    if (!casting) return new Set<Square>();
    const list =
      casting.first === null
        ? spellPrimaryTargets(game, game.turn, casting.spell)
        : spellSecondaryTargets(game, game.turn, casting.spell, casting.first);
    return new Set(list);
  }, [game, casting]);

  /** Arms (or disarms) a spell card. Untargeted spells cast immediately. */
  const selectSpell = useCallback(
    (spell: string) => {
      setSession((current) => {
        const state = current.game;
        if (isGameOver(state) || state.phase !== 'main') return current;
        if (current.casting?.spell === spell) return { ...current, casting: null };
        if (!state.spells[state.turn].available.includes(spell)) return current;

        if (getSpellDefinition(spell).targeting === 'none') {
          const next = castSpell(state, { spell, color: state.turn, targets: [] });
          return next ? newSession(next) : current;
        }
        return { ...current, selected: null, pendingChoice: null, casting: { spell, first: null } };
      });
    },
    [],
  );

  const cancelSpell = useCallback(() => {
    setSession((current) => ({ ...current, casting: null }));
  }, []);

  const canSelect = useCallback(
    (square: Square) => {
      const piece = game.board[square];
      if (!piece || piece.color !== game.turn || isGameOver(game)) return false;
      // During a bonus phase only pieces that actually have a free move count.
      if (game.phase === 'bonus') return generateLegalMovesFrom(game, square).length > 0;
      return true;
    },
    [game],
  );

  const commit = useCallback((state: GameState, move: Move) => {
    setSession(newSession(applyMove(state, move)));
  }, []);

  /** Attempts a move; opens the choice picker when the move is ambiguous. */
  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      const candidates = legalMovesBetween(game, from, to);
      const first = candidates[0];
      if (!first) return false;

      if (candidates.length > 1) {
        setSession((current) => ({
          ...current,
          selected: from,
          pendingChoice: { from, to, options: candidates },
        }));
        return true;
      }
      commit(game, first);
      return true;
    },
    [game, commit],
  );

  /** Single entry point for a click on a square. */
  const selectSquare = useCallback(
    (square: Square) => {
      if (pendingChoice || isGameOver(game)) return;

      // An armed spell swallows board clicks until cast or cancelled.
      if (casting) {
        if (!spellTargets.has(square)) return; // click a legal target or cancel
        const needsSecond =
          getSpellDefinition(casting.spell).targeting.includes('then') && casting.first === null;
        if (needsSecond) {
          setSession((current) => ({
            ...current,
            casting: { spell: casting.spell, first: square },
          }));
          return;
        }
        const targets = casting.first === null ? [square] : [casting.first, square];
        const next = castSpell(game, { spell: casting.spell, color: game.turn, targets });
        if (next) setSession(newSession(next));
        return;
      }

      if (selected !== null && selected !== square && tryMove(selected, square)) return;

      // Clicking the selected piece again: if it has moves onto its own
      // square (the Spy's transformation), open the chooser instead of
      // deselecting.
      if (selected === square) {
        const selfMoves = legalMovesBetween(game, square, square);
        if (selfMoves.length > 0) {
          setSession((current) => ({
            ...current,
            pendingChoice: { from: square, to: square, options: selfMoves },
          }));
          return;
        }
      }

      setSession((current) => ({
        ...current,
        selected: canSelect(square) && square !== selected ? square : null,
      }));
    },
    [pendingChoice, game, selected, tryMove, canSelect, casting, spellTargets],
  );

  const chooseMove = useCallback(
    (move: Move) => {
      if (!pendingChoice) return;
      commit(game, move);
    },
    [game, pendingChoice, commit],
  );

  const cancelChoice = useCallback(() => {
    setSession((current) => ({ ...current, pendingChoice: null, selected: null }));
  }, []);

  /** Ends the optional free-move phase without using it. */
  const passBonus = useCallback(() => {
    setSession((current) => newSession(skipBonusMove(current.game)));
  }, []);

  const newGame = useCallback(() => setSession(newSession(createGame())), [createGame]);

  return {
    game,
    selected,
    pendingChoice,
    casting,
    spellTargets,
    selectSpell,
    cancelSpell,
    movesBySquare,
    lastMove,
    checkSquare,
    inCheck: (color: Color) => isInCheck(game, color),
    gameOver: isGameOver(game),
    selectSquare,
    tryMove,
    chooseMove,
    cancelChoice,
    passBonus,
    newGame,
  };
}

export type ChessGameController = ReturnType<typeof useChessGame>;

/** Describes a variant move for the choice picker. */
export function describeMoveOption(move: Move): { label: string; detail: string; promotion?: PieceType } {
  if (move.promotion) {
    return { label: move.promotion, detail: 'Promote', promotion: move.promotion };
  }
  if (move.special === 'defect') {
    return { label: 'Defect', detail: 'Sacrifice and swap armies with the opponent' };
  }
  if (move.returns) {
    return { label: 'Advance & return', detail: `Bring a captured ${move.returns.type} back to the vacated square` };
  }
  return { label: 'Move', detail: move.captured ? 'Capture' : 'Just move' };
}
