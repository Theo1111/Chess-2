/**
 * Pure record builders: GameState/Roster → the rows Supabase stores.
 *
 * Kept free of any network or client import so they are unit-testable and so
 * the shape of what gets stored is reviewable in one place. A match row
 * stores the SAN move list plus the starting FEN — exactly what the engine
 * needs to replay the game — and the final FEN for cheap display.
 */

import { START_FEN, toFen, type GameState } from '../engine';
import { rosterCost, type Roster } from '../roster';
import type { TimeControlId } from '../ui/timeControls';

export interface MatchRow {
  /** Every game is a custom-army game; the column also holds legacy rows. */
  readonly mode: 'custom';
  readonly time_control: string;
  readonly winner: 'white' | 'black' | 'draw' | null;
  readonly reason: string;
  readonly plies: number;
  readonly moves: readonly string[];
  readonly start_fen: string;
  readonly final_fen: string;
  readonly white_army: Roster | null;
  readonly black_army: Roster | null;
  readonly content_fingerprint: string | null;
}

export interface ArmyRow {
  readonly name: string;
  readonly roster: Roster;
  readonly points: number;
  readonly content_fingerprint: string | null;
}

export interface MatchRowInput {
  readonly game: GameState;
  /** The clock the match was played under; omitted means it had none. */
  readonly timeControl?: TimeControlId;
  /** Match-level result when it differs from the engine's (a fallen flag). */
  readonly override?: { winner: 'white' | 'black'; reason: string } | null;
  readonly armies?: { white: Roster; black: Roster } | null;
  readonly contentFingerprint?: string | null;
}

/** The engine's own verdict, mapped to a stored result. */
function engineResult(game: GameState): { winner: MatchRow['winner']; reason: string } {
  if (game.winner) return { winner: game.winner, reason: game.status };
  if (game.status === 'stalemate' || game.status.startsWith('draw-')) {
    return { winner: 'draw', reason: game.status };
  }
  return { winner: null, reason: game.status }; // abandoned mid-game
}

export function buildMatchRow(input: MatchRowInput): MatchRow {
  const result = input.override
    ? { winner: input.override.winner, reason: input.override.reason }
    : engineResult(input.game);

  return {
    mode: 'custom',
    time_control: input.timeControl ?? 'unlimited',
    winner: result.winner,
    reason: result.reason,
    plies: input.game.history.length,
    moves: input.game.history.map((entry) => entry.san),
    start_fen: input.game.history[0]?.fenBefore ?? START_FEN,
    final_fen: toFen(input.game),
    white_army: input.armies?.white ?? null,
    black_army: input.armies?.black ?? null,
    content_fingerprint: input.contentFingerprint ?? null,
  };
}

export function buildArmyRow(
  name: string,
  roster: Roster,
  contentFingerprint: string | null = null,
): ArmyRow {
  return {
    name: name.trim() || 'Unnamed army',
    roster,
    points: rosterCost(roster),
    content_fingerprint: contentFingerprint,
  };
}
