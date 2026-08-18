/**
 * The pattern walker: the single piece of code that turns a declarative
 * {@link MovementPattern} into concrete destination squares.
 *
 * Every mover in the game — standard or custom — goes through here, so a new
 * Chess 2 piece only has to describe itself as vectors + flags. The flags now
 * cover four families of movement:
 *
 *   - plain leaps and slides (all standard pieces)
 *   - restricted reach: `minRange` (Archer), capture/quiet-only, directional
 *   - `hop`: capture by jumping a screen piece (Catapult, à la Xiangqi)
 *   - `runUntilBlocked`: cannot stop voluntarily (Jouster)
 *
 * `captureFriendly` lets a pattern treat friendly pieces as capturable
 * (Berserker); `passThroughAllies` lets slides ignore friendly blockers
 * (Infiltrator).
 */

import { fileOf, isInside, makeSquare, rankOf } from './board';
import type { MovementPattern } from './pieces';
import type { Board, Color, Piece, Square } from './types';

/**
 * Visits each reachable square. `captureSquare` is where the captured piece
 * actually stands — it differs from `to` only for stab captures (Spearman),
 * where the mover lands short of its victim.
 */
export type PatternVisitor = (to: Square, target: Piece | null, captureSquare?: Square) => void;

export interface WalkOptions {
  /**
   * Attack-probing mode: report every square the pattern could capture on.
   * Empty squares count (a piece standing there would be capturable), quiet
   * ability is ignored, and forced-run patterns behave like plain slides.
   */
  readonly captureOnly?: boolean;
  /**
   * Temporarily impassable terrain (active Dead Zones): cannot be entered,
   * landed on, hopped over or slid through — a wall for every walker.
   */
  readonly blocked?: ReadonlySet<Square>;
}

const DEFAULT_SLIDE_RANGE = 8;

export function walkPattern(
  board: Board,
  from: Square,
  color: Color,
  pattern: MovementPattern,
  visit: PatternVisitor,
  options: WalkOptions = {},
): void {
  const canCapture = pattern.capture !== false;
  if (options.captureOnly && !canCapture) return;

  const long = pattern.sliding || pattern.hop || pattern.runUntilBlocked;
  const steps = long ? (pattern.range ?? DEFAULT_SLIDE_RANGE) : 1;
  const startFile = fileOf(from);
  const startRank = rankOf(from);

  for (const vector of pattern.vectors) {
    const deltaFile = vector[0];
    const deltaRank = pattern.directional && color === 'black' ? -vector[1] : vector[1];

    if (pattern.hop) {
      walkHop(board, color, startFile, startRank, deltaFile, deltaRank, steps, visit, options);
    } else if (pattern.runUntilBlocked && !options.captureOnly) {
      walkForcedRun(board, color, startFile, startRank, deltaFile, deltaRank, steps, visit, options);
    } else if (pattern.stopShort && options.captureOnly) {
      // For attack probing a stab behaves like a capture with min range 2:
      // the victim's square is threatened, the landing square is incidental.
      const probePattern: MovementPattern = { ...pattern, stopShort: false, minRange: Math.max(pattern.minRange ?? 1, 2) };
      walkStandard(board, color, startFile, startRank, deltaFile, deltaRank, steps, probePattern, visit, options);
    } else {
      walkStandard(board, color, startFile, startRank, deltaFile, deltaRank, steps, pattern, visit, options);
    }
  }
}

/** Plain leaps and slides, including minRange / friendly-capture variants. */
function walkStandard(
  board: Board,
  color: Color,
  startFile: number,
  startRank: number,
  deltaFile: number,
  deltaRank: number,
  steps: number,
  pattern: MovementPattern,
  visit: PatternVisitor,
  options: WalkOptions,
): void {
  const canCapture = pattern.capture !== false;
  const canMoveQuiet = pattern.quiet !== false;
  const minRange = pattern.minRange ?? 1;
  let file = startFile;
  let rank = startRank;
  let previous: Square | null = null;

  for (let step = 1; step <= steps; step++) {
    file += deltaFile;
    rank += deltaRank;
    if (!isInside(file, rank)) break;

    const to = makeSquare(file, rank);
    if (options.blocked?.has(to)) break; // impassable terrain
    const target = board[to] ?? null;
    const inRange = step >= minRange;

    if (!target) {
      // In captureOnly (attack-probing) mode an empty square still counts:
      // a square is "attacked" if the piece could capture on it.
      if (inRange && (options.captureOnly || canMoveQuiet)) visit(to, null);
      previous = to;
      continue;
    }

    if (target.color === color) {
      // Friendly piece: normally a wall — unless this pattern may destroy
      // its own (Berserker) or slide straight through (Infiltrator).
      if (canCapture && pattern.captureFriendly && inRange) visit(to, target);
      // (previous stays on the last *empty* square: a stab can never land
      // on a friendly piece that was slid through.)
      if (pattern.passThroughAllies && pattern.sliding) continue;
      break;
    }

    if (canCapture && inRange) {
      if (pattern.stopShort) {
        // Stab: land one square before the victim. Adjacent = no square.
        if (previous !== null) visit(previous, target, to);
      } else {
        visit(to, target);
      }
    }
    break;
  }
}

/**
 * Cannon-style capture: slide to the first piece (the screen), jump it, and
 * capture the first enemy piece beyond it. Anything may screen; friendly
 * pieces beyond the screen protect their square.
 */
function walkHop(
  board: Board,
  color: Color,
  startFile: number,
  startRank: number,
  deltaFile: number,
  deltaRank: number,
  steps: number,
  visit: PatternVisitor,
  options: WalkOptions,
): void {
  let file = startFile;
  let rank = startRank;
  let passedScreen = false;

  for (let step = 1; step <= steps; step++) {
    file += deltaFile;
    rank += deltaRank;
    if (!isInside(file, rank)) break;

    const to = makeSquare(file, rank);
    if (options.blocked?.has(to)) break; // terrain stops even launched shots
    const target = board[to] ?? null;

    if (!passedScreen) {
      if (target) passedScreen = true; // jump the screen and keep flying
      continue;
    }

    if (!target) continue;
    if (target.color !== color) visit(to, target);
    break; // first piece beyond the screen ends the line either way
  }
}

/**
 * Forced run: the piece cannot stop voluntarily. Per direction it either
 * captures the first enemy piece, halts just before a friendly piece, or
 * runs to the board edge. Exactly one destination per direction.
 */
function walkForcedRun(
  board: Board,
  color: Color,
  startFile: number,
  startRank: number,
  deltaFile: number,
  deltaRank: number,
  steps: number,
  visit: PatternVisitor,
  options: WalkOptions,
): void {
  let file = startFile;
  let rank = startRank;
  let lastEmpty: Square | null = null;

  for (let step = 1; step <= steps; step++) {
    file += deltaFile;
    rank += deltaRank;
    if (!isInside(file, rank)) break;

    const to = makeSquare(file, rank);
    if (options.blocked?.has(to)) break; // halt before terrain, like an ally
    const target = board[to] ?? null;

    if (!target) {
      lastEmpty = to;
      continue;
    }
    if (target.color === color) break; // halt just before a friendly piece
    visit(to, target); // charge into the first enemy
    return;
  }

  if (lastEmpty !== null) visit(lastEmpty, null); // ran to the edge
}

export function walkPatterns(
  board: Board,
  from: Square,
  color: Color,
  patterns: readonly MovementPattern[],
  visit: PatternVisitor,
  options: WalkOptions = {},
): void {
  for (const pattern of patterns) walkPattern(board, from, color, pattern, visit, options);
}
