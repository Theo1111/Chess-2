import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_SIZE,
  FILE_COUNT,
  RANK_COUNT,
  blockedSquares,
  getPieceDefinition,
  hasAbility,
  makeSquare,
  obscuredSquaresFor,
  ownRoyalSquare,
  squareName,
  surroundingSquares,
  visibleTraps,
  type Color,
  type Move,
  type Square,
} from '../../engine';
import { PieceIcon } from '../pieces/PieceIcon';
import type { GameState } from '../../engine';

/**
 * The slice of a game controller the board actually consumes. Local play
 * passes `useChessGame`'s full controller; online play passes
 * `useOnlineController`, which submits moves to the server instead of
 * applying them. The board cannot tell the difference — by design.
 */
export interface BoardController {
  readonly game: GameState;
  readonly selected: Square | null;
  readonly movesBySquare: ReadonlyMap<Square, Move[]>;
  readonly lastMove: Move | null;
  readonly checkSquare: Square | null;
  readonly spellTargets: ReadonlySet<Square>;
  readonly selectSquare: (square: Square) => void;
  readonly tryMove: (from: Square, to: Square) => boolean;
}

interface BoardProps {
  controller: BoardController;
  /**
   * Whose side of the table to render from. Black flips both axes so a
   * player's own pieces are always nearest — and swaps in the board artwork
   * whose painted a–i / 1–9 labels are ordered for that view, since those
   * coordinates live in the image, not the DOM.
   */
  orientation?: Color;
}

const RANKS_WHITE = Array.from({ length: RANK_COUNT }, (_, index) => RANK_COUNT - 1 - index);
const FILES_WHITE = Array.from({ length: FILE_COUNT }, (_, index) => index);
/** Black sees the board from the far side: both axes reverse. */
const RANKS_BLACK = [...RANKS_WHITE].reverse();
const FILES_BLACK = [...FILES_WHITE].reverse();

/**
 * The board is a dumb renderer: it asks the controller what to highlight and
 * reports pointer interactions back. It contains no chess rules of its own.
 *
 * Both interaction styles route through the same controller calls:
 * click-to-select then click-to-move, or press-and-drag onto a target square.
 */
export function Board({ controller, orientation = 'white' }: BoardProps) {
  const { game, selected, movesBySquare, lastMove, checkSquare, selectSquare, tryMove, spellTargets } = controller;

  // An Ambusher's guard zone, shown while it is selected so players can see
  // which squares are dangerous to pass through.
  const guardZone = useMemo(() => {
    if (selected === null) return null;
    const piece = game.board[selected];
    if (!piece) return null;
    if (!hasAbility(getPieceDefinition(piece.type).abilities, 'ambush-passers')) return null;
    return new Set(surroundingSquares(selected));
  }, [game, selected]);

  // A Kingsguard's allowed radius around its King, shown while selected.
  const kingRadius = useMemo(() => {
    if (selected === null) return null;
    const piece = game.board[selected];
    if (!piece) return null;
    const radius = getPieceDefinition(piece.type).metadata?.kingRadius;
    if (typeof radius !== 'number') return null;
    const king = ownRoyalSquare(game, piece.color);
    if (king === null) return null;
    const zone = new Set<Square>();
    for (let square = 0; square < BOARD_SIZE; square++) {
      const df = Math.abs((square % FILE_COUNT) - (king % FILE_COUNT));
      const dr = Math.abs(Math.floor(square / FILE_COUNT) - Math.floor(king / FILE_COUNT));
      if (Math.max(df, dr) <= radius) zone.add(square);
    }
    return zone;
  }, [game, selected]);

  // Card-state overlays: regions, terrain, wards and the viewer's traps.
  const overlays = useMemo(() => {
    const smoke = new Set<Square>();
    const nullField = new Set<Square>();
    for (const region of game.regions) {
      for (const square of region.squares) {
        (region.kind === 'smoke' ? smoke : nullField).add(square);
      }
    }
    const sacred = new Set<Square>();
    for (const status of game.squareStatuses) {
      if (status.kind === 'sacred-ground') sacred.add(status.square);
    }
    const traps = new Map<Square, { icon: string; revealed: boolean }>();
    for (const trap of visibleTraps(game, game.turn)) {
      if (!trap.armed) continue;
      traps.set(trap.square, {
        icon: trap.trap === 'tripwire' ? '🪤' : trap.trap === 'sonar' ? '📡' : trap.trap === 'web-trap' ? '🕸️' : '☠️',
        revealed: trap.revealed,
      });
    }
    return {
      smoke,
      nullField,
      sacred,
      dead: blockedSquares(game),
      traps,
      obscured: obscuredSquaresFor(game, game.turn),
    };
  }, [game]);

  // Squares whose occupant dies to a currently-highlighted move even though
  // the mover lands elsewhere (Spearman stabs, ambushes, en passant).
  const victimSquares = useMemo(() => {
    const set = new Set<Square>();
    for (const moves of movesBySquare.values()) {
      for (const move of moves) {
        if (move.captured && move.captured.square !== move.to) set.add(move.captured.square);
      }
    }
    return set;
  }, [movesBySquare]);
  // `dragFrom` drives styling; the ref is what the listener reads, so the
  // release is handled even when it arrives before React has re-rendered.
  const [dragFrom, setDragFrom] = useState<Square | null>(null);
  const dragFromRef = useRef<Square | null>(null);

  const startDrag = (square: Square) => {
    dragFromRef.current = square;
    setDragFrom(square);
  };

  // Resolve the drop target from wherever the pointer was released. A window
  // listener (rather than per-square onPointerUp) keeps touch working, where
  // the pointer is implicitly captured by the element it started on.
  useEffect(() => {
    const clear = () => {
      dragFromRef.current = null;
      setDragFrom(null);
    };

    const finish = (event: PointerEvent) => {
      const from = dragFromRef.current;
      clear();
      if (from === null) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-square]');
      const to = target ? Number(target.dataset.square) : NaN;
      if (Number.isInteger(to) && to !== from) tryMove(from, to);
    };

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', clear);
    };
  }, [tryMove]);

  return (
    <div className={`board-frame${orientation === 'black' ? ' board-frame--black' : ''}`}>
      <div className="board" role="grid" aria-label="Chess board">
        {(orientation === 'black' ? RANKS_BLACK : RANKS_WHITE).map((rank) =>
          (orientation === 'black' ? FILES_BLACK : FILES_WHITE).map((file) => {
            const square = makeSquare(file, rank);
            const piece = game.board[square];
            const moves = movesBySquare.get(square);
            const isTarget = Boolean(moves);
            const isCapture = Boolean(moves?.[0]?.captured);

            const classes = [
              'square',
              // Parity matches the board artwork: a1 is a light square.
              (file + rank) % 2 === 0 ? 'square--light' : 'square--dark',
              selected === square ? 'square--selected' : '',
              isTarget ? (isCapture ? 'square--capture' : 'square--move') : '',
              isLastMoveSquare(lastMove, square) ? 'square--last' : '',
              checkSquare === square ? 'square--check' : '',
              dragFrom === square ? 'square--dragging' : '',
              guardZone?.has(square) ? 'square--guarded' : '',
              kingRadius?.has(square) ? 'square--radius' : '',
              victimSquares.has(square) ? 'square--victim' : '',
              spellTargets.has(square) ? 'square--spell' : '',
              overlays.smoke.has(square) ? 'square--smoke' : '',
              overlays.nullField.has(square) ? 'square--null' : '',
              overlays.sacred.has(square) ? 'square--sacred' : '',
              overlays.dead.has(square) ? 'square--dead' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={square}
                type="button"
                role="gridcell"
                data-square={square}
                className={classes}
                aria-label={`${squareName(square)}${piece ? `, ${piece.color} ${piece.type}` : ''}`}
                onPointerDown={() => {
                  selectSquare(square);
                  if (piece && piece.color === game.turn) startDrag(square);
                }}
                // Keyboard/assistive activation still works: a click that did
                // not come from a pointer press is handled here instead.
                onClick={(event) => {
                  if (event.detail === 0) selectSquare(square);
                }}
              >
                {piece && overlays.obscured.has(square) && piece.color !== game.turn ? (
                  <span className="square__piece square__piece--hidden" title="Obscured by smoke">
                    <span className="square__fogmark">?</span>
                  </span>
                ) : piece ? (
                  <span className="square__piece">
                    <PieceIcon type={piece.type} color={piece.color} />
                    {game.effects.some((e) => e.kind === 'shield' && e.targetPieceId === piece.id) && (
                      <span className="square__effect square__effect--shield" title="Shielded">🛡️</span>
                    )}
                    {game.effects.some((e) => e.kind === 'freeze' && e.targetPieceId === piece.id) && (
                      <span className="square__effect square__effect--freeze" title="Frozen">❄️</span>
                    )}
                    {game.effects.some((e) => e.kind === 'webbed' && e.targetPieceId === piece.id) && (
                      <span className="square__effect square__effect--freeze" title="Webbed">🕸️</span>
                    )}
                    {piece.origin !== undefined && piece.origin !== piece.type && (
                      <span
                        className="square__origin"
                        aria-label={`originally a ${piece.origin}`}
                        title={`Originally a ${getPieceDefinition(piece.origin).name}`}
                      >
                        <PieceIcon type={piece.origin} color={piece.color} />
                      </span>
                    )}
                    {piece.hitPoints !== undefined && (
                      <span
                        className="square__hp"
                        aria-label={`${piece.hitPoints} hit points`}
                      >
                        {Array.from({ length: piece.hitPoints }, (_, index) => (
                          <span key={index} className="square__hp-pip" />
                        ))}
                      </span>
                    )}
                  </span>
                ) : null}

                {overlays.traps.has(square) && (
                  <span
                    className={`square__trap${overlays.traps.get(square)!.revealed ? ' square__trap--revealed' : ''}`}
                    title={overlays.traps.get(square)!.revealed ? 'Revealed trap' : 'Your hidden trap'}
                  >
                    {overlays.traps.get(square)!.icon}
                  </span>
                )}

                {isTarget && (
                  <span className={isCapture ? 'hint hint--capture' : 'hint hint--move'} />
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function isLastMoveSquare(lastMove: Move | null, square: Square): boolean {
  if (!lastMove) return false;
  return lastMove.from === square || lastMove.to === square;
}
