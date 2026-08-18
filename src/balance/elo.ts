/**
 * Elo ratings.
 *
 * Two independent ladders use this module: agent strength (is the AI getting
 * better?) and army strength (is this composition winning?). They must never
 * be mixed — an army's rating means nothing on the agent ladder and vice
 * versa, so the table is just data and the caller owns which ladder it is.
 *
 * Glicko-2 (with uncertainty) is a planned upgrade; keeping this module's
 * surface small (expected score + record result) leaves room for it.
 */

export interface EloEntry {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export type EloTable = Map<string, EloEntry>;

export const ELO_INITIAL = 1000;
export const ELO_K = 24;

export const createEloTable = (): EloTable => new Map();

function entry(table: EloTable, id: string): EloEntry {
  let existing = table.get(id);
  if (!existing) {
    existing = { rating: ELO_INITIAL, games: 0, wins: 0, losses: 0, draws: 0 };
    table.set(id, existing);
  }
  return existing;
}

/** Probability the first player scores, under the Elo model. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Records one game. `score` is from A's perspective: 1 win, 0.5 draw, 0 loss.
 */
export function recordResult(
  table: EloTable,
  idA: string,
  idB: string,
  score: 0 | 0.5 | 1,
  k = ELO_K,
): void {
  const a = entry(table, idA);
  const b = entry(table, idB);

  const expected = expectedScore(a.rating, b.rating);
  a.rating += k * (score - expected);
  b.rating += k * ((1 - score) - (1 - expected));

  a.games++;
  b.games++;
  if (score === 1) {
    a.wins++;
    b.losses++;
  } else if (score === 0) {
    a.losses++;
    b.wins++;
  } else {
    a.draws++;
    b.draws++;
  }
}

/** Entries sorted strongest first, for reports. */
export function rankings(table: EloTable): (EloEntry & { id: string })[] {
  return [...table.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.rating - a.rating);
}
