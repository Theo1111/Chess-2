/**
 * Turning rosters into a game.
 *
 * This is the only bridge between the roster layer and the engine: two valid,
 * fully-deployed rosters in, one `GameState` out. A match keeps its rosters
 * alongside the game so later systems (rematches, replays, post-game summaries)
 * can see which armies produced the position.
 */

import { createStateFromBoard, emptyBoard, createPiece, type Board, type GameState } from '../engine';
import { loadoutCardIds } from './loadout';
import { validateRoster } from './validation';
import type { Roster } from './types';

export interface Match {
  readonly rosters: { readonly white: Roster; readonly black: Roster };
  readonly game: GameState;
}

/** Places one army onto a board. Assumes the roster has already been validated. */
export function deployRoster(board: Board, roster: Roster): Board {
  const next = board.slice();
  for (const unit of roster.units) {
    const square = roster.placement[unit.id];
    if (square === undefined) continue;
    next[square] = createPiece(roster.color, unit.type, square);
  }
  return next;
}

export function buildBoardFromRosters(white: Roster, black: Roster): Board {
  return deployRoster(deployRoster(emptyBoard(), white), black);
}

/**
 * Validates both armies and starts the match. Throws rather than producing an
 * illegal board — callers should validate first and show the errors.
 */
export function createMatch(white: Roster, black: Roster): Match {
  for (const roster of [white, black]) {
    const result = validateRoster(roster, { requirePlacement: true, requireLoadout: true });
    if (!result.valid) {
      throw new Error(
        `Invalid ${roster.color} roster: ${result.errors.map((error) => error.message).join(' ')}`,
      );
    }
  }

  return {
    rosters: { white, black },
    game: createStateFromBoard(buildBoardFromRosters(white, black), {
      spellBooks: { white: loadoutCardIds(white), black: loadoutCardIds(black) },
    }),
  };
}

/** Convenience for tests and quick starts. */
export const createGameFromRosters = (white: Roster, black: Roster): GameState =>
  createMatch(white, black).game;
