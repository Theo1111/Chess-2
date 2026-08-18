/**
 * The trap engine — how hidden trap placements react to movement.
 *
 * Three moments in a move's life:
 *
 *  1. **Interception** (Tripwire): before a move is applied, a trap on a
 *     square the piece physically travels through can cut the move short.
 *  2. **Landing** (Web Trap, Sonar, Dead Zone): after the move, a trap on
 *     the destination fires against the arriving piece.
 *  3. **Departure** (Dead Zone): a pending zone activates into blocked
 *     terrain the moment its triggering piece leaves the square by any
 *     means — moving, being captured, teleported or otherwise removed.
 *
 * "Physically travels" is derived from the movement engine, not piece ids:
 * a move traverses its straight-line path when every intermediate square was
 * empty (sliders) and the move is not a teleport. Knights have no straight
 * path; the Diplomat, Squire and royal swaps leap or teleport; the Catapult's
 * launched capture arcs over a screen and is treated as flight.
 */

import { applyMoveToBoard } from './apply';
import { straightPath } from './board';
import { isCardImmuneAt, regionSquares, revealHiddenIn } from './boardEffects';
import type { SquareStatus, TrapPlacement } from './boardEffects';
import { isRoyalAttacked } from './moveGeneration';
import { getPieceDefinition } from './pieces';
import type { GameState, Move, Square } from './types';
import { opposite } from './types';

/**
 * Dead zones block for one full round — one turn for each player. Activation
 * happens after the turn boundary has already ticked, so 2 covers exactly
 * the next two plies.
 */
const DEAD_ZONE_PLIES = 2;

/** Squares this move physically travels through, or [] for leaps/teleports. */
export function traveledPath(state: GameState, move: Move): Square[] {
  if (move.teleport || move.special === 'royal-swap' || move.special === 'transform') return [];
  const path = straightPath(move.from, move.to);
  if (path.length === 0) return [];
  // A slider's path is empty by definition; an occupied intermediate square
  // means the piece leapt or was launched over it (Diplomat over a piece,
  // Catapult over its screen) — flight does not touch the ground.
  return path.every((square) => !state.board[square]) ? path : [];
}

export interface InterceptResult {
  readonly move: Move;
  readonly tripped: boolean;
  readonly traps: readonly TrapPlacement[];
}

/**
 * Tripwire: if the mover travels across an armed enemy tripwire, the move is
 * cut short on the trap square and the trap is revealed and spent. A piece
 * under card immunity (Sacred Ground, at its starting square) trips nothing.
 * If stopping short would leave the mover's king attacked, the interruption
 * cannot legally happen: the wire still fires, but the move completes.
 */
export function interceptTripwire(state: GameState, move: Move): InterceptResult {
  if (state.traps.length === 0) return { move, tripped: false, traps: state.traps };

  const path = traveledPath(state, move);
  if (path.length === 0) return { move, tripped: false, traps: state.traps };
  if (isCardImmuneAt(state, move.from)) return { move, tripped: false, traps: state.traps };

  const wire = state.traps.find(
    (trap) =>
      trap.armed &&
      trap.trap === 'tripwire' &&
      trap.owner === opposite(move.color) &&
      path.includes(trap.square),
  );
  if (!wire) return { move, tripped: false, traps: state.traps };

  const traps = state.traps.map((trap) =>
    trap.id === wire.id ? { ...trap, revealed: true, armed: false } : trap,
  );

  const shortened: Move = {
    from: move.from,
    to: wire.square,
    piece: move.piece,
    color: move.color,
    ...(move.bonus ? { bonus: true } : {}),
  };

  // The interruption must not create an illegal king state; if it would,
  // the original movement completes (the wire is still spent).
  const probe = { ...state, board: applyMoveToBoard(state.board, shortened) };
  if (isRoyalAttacked(probe, move.color)) {
    return { move, tripped: false, traps };
  }

  return { move: shortened, tripped: true, traps };
}

export interface LandingResult {
  readonly traps: readonly TrapPlacement[];
  readonly squareStatuses: readonly SquareStatus[];
  readonly webbedPieceId: string | null;
  /** Mine: the square whose occupant is destroyed (validated by the caller). */
  readonly destroyedSquare: Square | null;
}

/**
 * Landing triggers plus dead-zone activation, evaluated on the post-move
 * state. `moverSquare` is where the moved piece now stands (null when the
 * move was a spell with no arriving piece).
 */
export function processTraps(
  after: Pick<GameState, 'board' | 'traps' | 'squareStatuses'>,
  moverSquare: Square | null,
  moverImmune: boolean,
): LandingResult {
  let traps = after.traps;
  let squareStatuses = after.squareStatuses;
  let webbedPieceId: string | null = null;
  let destroyedSquare: Square | null = null;

  const arriving = moverSquare !== null ? after.board[moverSquare] : null;

  if (arriving && moverSquare !== null) {
    const landedOn = traps.find(
      (trap) => trap.armed && trap.square === moverSquare && trap.owner !== arriving.color,
    );
    if (landedOn) {
      if (landedOn.trap === 'web-trap') {
        traps = traps.map((trap) =>
          trap.id === landedOn.id ? { ...trap, revealed: true, armed: false } : trap,
        );
        if (!moverImmune) webbedPieceId = arriving.id;
      } else if (landedOn.trap === 'sonar') {
        // The scan reveals every hidden enemy effect in the 3×3 around it.
        const zone = new Set(regionSquares(landedOn.square));
        const disarmed = traps.map((trap) =>
          trap.id === landedOn.id ? { ...trap, revealed: true, armed: false } : trap,
        );
        traps = revealHiddenIn(disarmed, zone, landedOn.owner).traps;
      } else if (landedOn.trap === 'mine') {
        traps = traps.map((trap) =>
          trap.id === landedOn.id ? { ...trap, revealed: true, armed: false } : trap,
        );
        // Destruction, not capture — and never of a King: a royal survives
        // the blast (the mine is still spent).
        if (!moverImmune && !getPieceDefinition(arriving.type).royal) {
          destroyedSquare = moverSquare;
        }
      } else if (landedOn.trap === 'dead-zone') {
        traps = traps.map((trap) =>
          trap.id === landedOn.id
            ? { ...trap, revealed: true, pendingPieceId: arriving.id }
            : trap,
        );
      }
      // Tripwires only fire on pass-through; landing on one leaves it armed.
    }
  }

  // Pending dead zones whose triggering piece has left — by any means —
  // become blocked terrain.
  for (const trap of traps) {
    if (trap.trap !== 'dead-zone' || !trap.armed || !trap.pendingPieceId) continue;
    const occupant = after.board[trap.square];
    if (occupant && occupant.id === trap.pendingPieceId) continue;
    traps = traps.map((entry) =>
      entry.id === trap.id ? { ...entry, armed: false } : entry,
    );
    squareStatuses = [
      ...squareStatuses,
      {
        id: `dz:${trap.id}`,
        kind: 'dead-zone',
        owner: trap.owner,
        square: trap.square,
        pliesRemaining: DEAD_ZONE_PLIES,
      },
    ];
  }

  return { traps, squareStatuses, webbedPieceId, destroyedSquare };
}
