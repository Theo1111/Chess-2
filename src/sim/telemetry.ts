/**
 * Match telemetry — everything the balance layer will want to know about one
 * simulated game, extracted by watching state transitions.
 *
 * Extraction is observational: it reads the engine's own history entries and
 * diffs adjacent states. It never interprets rules itself, so new pieces and
 * cards are recorded without changes here.
 */

import type { Color, GameState, PieceType } from '../engine';
import type { GameAction } from '../ai/actions';

export interface CaptureEvent {
  readonly ply: number;
  /** The side credited with the removal (mover for captures). */
  readonly by: Color;
  readonly byPiece: PieceType;
  /** The piece that left the board. */
  readonly victim: PieceType;
  readonly victimColor: Color;
  /** True when the attacker died on armour instead (Champion repel). */
  readonly repelled: boolean;
}

export interface CardEvent {
  readonly ply: number;
  readonly by: Color;
  readonly card: string;
  readonly trap: boolean;
}

export interface TrapOutcome {
  readonly card: string;
  readonly owner: Color;
  readonly placedPly: number;
  /** Ply the trap left play or lost its charge; null if it survived the game. */
  readonly resolvedPly: number | null;
  /** True if the enemy set it off (as opposed to expiring or being disabled). */
  readonly triggered: boolean;
  readonly revealed: boolean;
}

export interface MatchTelemetry {
  readonly plies: number;
  readonly captures: readonly CaptureEvent[];
  readonly cardsPlayed: readonly CardEvent[];
  readonly traps: readonly TrapOutcome[];
  /** Pieces on the board at the end, counted per colour and type. */
  readonly survivors: Readonly<Record<Color, Readonly<Record<string, number>>>>;
  /** Pieces at the start, same shape — survival rates divide these. */
  readonly initial: Readonly<Record<Color, Readonly<Record<string, number>>>>;
}

export function countPieces(state: GameState): Record<Color, Record<string, number>> {
  const counts: Record<Color, Record<string, number>> = { white: {}, black: {} };
  for (const piece of state.board) {
    if (!piece) continue;
    counts[piece.color][piece.type] = (counts[piece.color][piece.type] ?? 0) + 1;
  }
  return counts;
}

/** Incrementally collects telemetry as the runner applies actions. */
export class TelemetryCollector {
  private readonly captures: CaptureEvent[] = [];
  private readonly cardsPlayed: CardEvent[] = [];
  private readonly trapLifecycles = new Map<
    string,
    { card: string; owner: Color; placedPly: number; resolvedPly: number | null; triggered: boolean; revealed: boolean }
  >();
  private readonly initial: Record<Color, Record<string, number>>;

  constructor(initialState: GameState) {
    this.initial = countPieces(initialState);
  }

  record(ply: number, before: GameState, action: GameAction, after: GameState): void {
    if (action.kind === 'move') {
      const move = action.move;
      if (move.repelled && move.captured === undefined) {
        // The attacker died on the defender's armour.
        const defender = before.board[move.to];
        if (defender) {
          this.captures.push({
            ply,
            by: defender.color,
            byPiece: defender.type,
            victim: move.piece,
            victimColor: move.color,
            repelled: true,
          });
        }
      }
      if (move.captured) {
        this.captures.push({
          ply,
          by: move.color,
          byPiece: move.piece,
          victim: move.captured.type,
          victimColor: move.captured.color,
          repelled: false,
        });
      }
      for (const extra of move.extraCaptures ?? []) {
        this.captures.push({
          ply,
          by: move.color,
          byPiece: move.piece,
          victim: extra.type,
          victimColor: extra.color,
          repelled: false,
        });
      }
    }

    if (action.kind === 'spell') {
      this.cardsPlayed.push({ ply, by: before.turn, card: action.spell, trap: action.trap });
    }

    // Trap lifecycle: diff placements between the states.
    const beforeById = new Map(before.traps.map((trap) => [trap.id, trap]));
    for (const trap of after.traps) {
      const known = this.trapLifecycles.get(trap.id);
      if (!known && !beforeById.has(trap.id)) {
        this.trapLifecycles.set(trap.id, {
          card: trap.trap,
          owner: trap.owner,
          placedPly: ply,
          resolvedPly: null,
          triggered: false,
          revealed: trap.revealed,
        });
      } else if (known) {
        if (trap.revealed) known.revealed = true;
        if (!trap.armed && known.resolvedPly === null) {
          known.resolvedPly = ply;
          known.triggered = true; // disarmed in place = it fired (Dead Zone)
        }
      }
    }
    for (const trap of before.traps) {
      if (after.traps.some((existing) => existing.id === trap.id)) continue;
      const known = this.trapLifecycles.get(trap.id);
      if (known && known.resolvedPly === null) {
        known.resolvedPly = ply;
        // A vanished trap either fired or was disabled by Interference; the
        // spell log tells the difference.
        known.triggered = !(
          action.kind === 'spell' && action.spell === 'interference'
        );
        if (known.triggered) known.revealed = true;
      }
    }
  }

  finish(finalState: GameState, plies: number): MatchTelemetry {
    return {
      plies,
      captures: this.captures,
      cardsPlayed: this.cardsPlayed,
      traps: [...this.trapLifecycles.values()],
      survivors: countPieces(finalState),
      initial: this.initial,
    };
  }
}
