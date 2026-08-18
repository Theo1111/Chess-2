/**
 * Aggregation: match records → per-piece, per-card, per-class and matchup
 * statistics. Pure functions over `MatchRecord[]`; nothing here touches the
 * engine, and every piece/card id comes from the records themselves, so new
 * content is aggregated automatically.
 *
 * Raw win rates here are DESCRIPTIVE. They deliberately do not correct for
 * army context — that is the regression model's job (model.ts). Every rate
 * ships with its sample size and a Wilson interval so downstream reporting
 * can refuse to over-read small samples.
 */

import type { Color } from '../engine';
import type { MatchRecord } from '../sim/tournament';

export interface RateWithConfidence {
  readonly rate: number;
  readonly games: number;
  readonly low: number;
  readonly high: number;
}

/** Wilson score interval (95%) — sane on small samples, never leaves [0,1]. */
export function wilson(successes: number, games: number): RateWithConfidence {
  if (games === 0) return { rate: 0, games: 0, low: 0, high: 1 };
  const z = 1.96;
  const p = successes / games;
  const denominator = 1 + (z * z) / games;
  const center = (p + (z * z) / (2 * games)) / denominator;
  const spread =
    (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / denominator;
  return { rate: p, games, low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

const scoreFor = (record: MatchRecord, side: Color): number =>
  record.winner === 'draw' ? 0.5 : record.winner === side ? 1 : 0;

export interface PieceStats {
  readonly piece: string;
  readonly gamesSelected: number;
  readonly armiesSelectedIn: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly winRate: RateWithConfidence;
  /** Mean of the as-white and as-black win rates — first-move bias removed. */
  readonly colorAdjustedWinRate: number;
  readonly averageCopies: number;
  readonly survivalRate: number;
  readonly averageCaptures: number;
}

export function pieceStats(records: readonly MatchRecord[]): Map<string, PieceStats> {
  interface Accumulator {
    games: number;
    armies: Set<string>;
    wins: number;
    losses: number;
    draws: number;
    scoreByColor: Record<Color, { score: number; games: number }>;
    copies: number;
    initial: number;
    survived: number;
    captures: number;
  }
  const accumulators = new Map<string, Accumulator>();
  const get = (piece: string): Accumulator => {
    let acc = accumulators.get(piece);
    if (!acc) {
      acc = {
        games: 0,
        armies: new Set(),
        wins: 0,
        losses: 0,
        draws: 0,
        scoreByColor: { white: { score: 0, games: 0 }, black: { score: 0, games: 0 } },
        copies: 0,
        initial: 0,
        survived: 0,
        captures: 0,
      };
      accumulators.set(piece, acc);
    }
    return acc;
  };

  for (const record of records) {
    for (const side of ['white', 'black'] as const) {
      const army = side === 'white' ? record.white : record.black;
      const score = scoreFor(record, side);
      for (const [piece, copies] of Object.entries(army.composition)) {
        const acc = get(piece);
        acc.games++;
        acc.armies.add(army.id);
        acc.copies += copies;
        if (score === 1) acc.wins++;
        else if (score === 0) acc.losses++;
        else acc.draws++;
        acc.scoreByColor[side].score += score;
        acc.scoreByColor[side].games++;

        if (record.telemetry) {
          acc.initial += record.telemetry.initial[side][piece] ?? 0;
          acc.survived += record.telemetry.survivors[side][piece] ?? 0;
        }
      }
      if (record.telemetry) {
        for (const capture of record.telemetry.captures) {
          if (capture.by === side) get(capture.byPiece).captures++;
        }
      }
    }
  }

  const result = new Map<string, PieceStats>();
  for (const [piece, acc] of accumulators) {
    const byColor = acc.scoreByColor;
    const whiteRate = byColor.white.games > 0 ? byColor.white.score / byColor.white.games : 0.5;
    const blackRate = byColor.black.games > 0 ? byColor.black.score / byColor.black.games : 0.5;
    result.set(piece, {
      piece,
      gamesSelected: acc.games,
      armiesSelectedIn: acc.armies.size,
      wins: acc.wins,
      losses: acc.losses,
      draws: acc.draws,
      winRate: wilson(acc.wins + acc.draws / 2, acc.games),
      colorAdjustedWinRate: (whiteRate + blackRate) / 2,
      averageCopies: acc.games > 0 ? acc.copies / acc.games : 0,
      survivalRate: acc.initial > 0 ? acc.survived / acc.initial : 0,
      averageCaptures: acc.games > 0 ? acc.captures / acc.games : 0,
    });
  }
  return result;
}

export interface SpellStats {
  readonly card: string;
  readonly gamesSelected: number;
  readonly gamesUsed: number;
  readonly pickRate: number;
  readonly useRate: number;
  readonly averagePlyUsed: number | null;
  readonly winRateWhenSelected: RateWithConfidence;
  readonly winRateWhenUsed: RateWithConfidence;
}

export interface TrapStats {
  readonly card: string;
  readonly gamesSelected: number;
  readonly gamesPlaced: number;
  readonly placementRate: number;
  readonly triggered: number;
  readonly triggerRate: number;
  readonly revealed: number;
  readonly revealRate: number;
  readonly averagePlyPlaced: number | null;
  readonly averagePlyTriggered: number | null;
  readonly winRateWhenSelected: RateWithConfidence;
}

export function cardStats(records: readonly MatchRecord[]): {
  spells: Map<string, SpellStats>;
  traps: Map<string, TrapStats>;
} {
  interface SpellAccumulator {
    selected: number;
    selectedScore: number;
    used: number;
    usedScore: number;
    usedPlies: number[];
  }
  interface TrapAccumulator {
    selected: number;
    selectedScore: number;
    placed: number;
    triggered: number;
    revealed: number;
    placedPlies: number[];
    triggeredPlies: number[];
  }
  const spells = new Map<string, SpellAccumulator>();
  const traps = new Map<string, TrapAccumulator>();
  const spellAcc = (card: string): SpellAccumulator => {
    let acc = spells.get(card);
    if (!acc) {
      acc = { selected: 0, selectedScore: 0, used: 0, usedScore: 0, usedPlies: [] };
      spells.set(card, acc);
    }
    return acc;
  };
  const trapAcc = (card: string): TrapAccumulator => {
    let acc = traps.get(card);
    if (!acc) {
      acc = {
        selected: 0,
        selectedScore: 0,
        placed: 0,
        triggered: 0,
        revealed: 0,
        placedPlies: [],
        triggeredPlies: [],
      };
      traps.set(card, acc);
    }
    return acc;
  };

  let totalSides = 0;
  for (const record of records) {
    for (const side of ['white', 'black'] as const) {
      totalSides++;
      const army = side === 'white' ? record.white : record.black;
      const score = scoreFor(record, side);

      for (const card of army.spells) {
        const acc = spellAcc(card);
        acc.selected++;
        acc.selectedScore += score;
      }
      for (const card of army.traps) {
        const acc = trapAcc(card);
        acc.selected++;
        acc.selectedScore += score;
      }

      if (record.telemetry) {
        const used = new Set<string>();
        for (const event of record.telemetry.cardsPlayed) {
          if (event.by !== side) continue;
          if (event.trap) {
            const acc = trapAcc(event.card);
            acc.placed++;
            acc.placedPlies.push(event.ply);
          } else if (!used.has(event.card)) {
            used.add(event.card);
            const acc = spellAcc(event.card);
            acc.used++;
            acc.usedScore += score;
            acc.usedPlies.push(event.ply);
          }
        }
        for (const outcome of record.telemetry.traps) {
          if (outcome.owner !== side) continue;
          const acc = trapAcc(outcome.card);
          if (outcome.triggered) {
            acc.triggered++;
            if (outcome.resolvedPly !== null) acc.triggeredPlies.push(outcome.resolvedPly);
          }
          if (outcome.revealed) acc.revealed++;
        }
      }
    }
  }

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  const spellResult = new Map<string, SpellStats>();
  for (const [card, acc] of spells) {
    spellResult.set(card, {
      card,
      gamesSelected: acc.selected,
      gamesUsed: acc.used,
      pickRate: totalSides > 0 ? acc.selected / totalSides : 0,
      useRate: acc.selected > 0 ? acc.used / acc.selected : 0,
      averagePlyUsed: mean(acc.usedPlies),
      winRateWhenSelected: wilson(acc.selectedScore, acc.selected),
      winRateWhenUsed: wilson(acc.usedScore, acc.used),
    });
  }
  const trapResult = new Map<string, TrapStats>();
  for (const [card, acc] of traps) {
    trapResult.set(card, {
      card,
      gamesSelected: acc.selected,
      gamesPlaced: acc.placed,
      placementRate: acc.selected > 0 ? acc.placed / acc.selected : 0,
      triggered: acc.triggered,
      triggerRate: acc.placed > 0 ? acc.triggered / acc.placed : 0,
      revealed: acc.revealed,
      revealRate: acc.placed > 0 ? acc.revealed / acc.placed : 0,
      averagePlyPlaced: mean(acc.placedPlies),
      averagePlyTriggered: mean(acc.triggeredPlies),
      winRateWhenSelected: wilson(acc.selectedScore, acc.selected),
    });
  }
  return { spells: spellResult, traps: trapResult };
}

export interface MatchupCell {
  readonly games: number;
  readonly score: number; // total score for the row army
}

/** armyId → armyId → aggregate score. Only fill cells with data. */
export function matchupMatrix(
  records: readonly MatchRecord[],
): Map<string, Map<string, MatchupCell>> {
  const matrix = new Map<string, Map<string, MatchupCell>>();
  const bump = (rowId: string, columnId: string, score: number) => {
    let row = matrix.get(rowId);
    if (!row) {
      row = new Map();
      matrix.set(rowId, row);
    }
    const cell = row.get(columnId) ?? { games: 0, score: 0 };
    row.set(columnId, { games: cell.games + 1, score: cell.score + score });
  };

  for (const record of records) {
    if (record.white.id === record.black.id) continue;
    bump(record.white.id, record.black.id, scoreFor(record, 'white'));
    bump(record.black.id, record.white.id, scoreFor(record, 'black'));
  }
  return matrix;
}

export interface FirstMoveReport {
  readonly games: number;
  readonly whiteScore: RateWithConfidence;
  readonly whiteWins: number;
  readonly blackWins: number;
  readonly draws: number;
  /** Restricted to mirrored games (same army on both sides of a pairing). */
  readonly mirroredGames: number;
  readonly mirroredWhiteScore: RateWithConfidence;
}

export function firstMoveAdvantage(records: readonly MatchRecord[]): FirstMoveReport {
  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let whiteScore = 0;

  // Mirrored evidence: pairs sharing (pairing, seed) with armies swapped.
  const byPairing = new Map<string, MatchRecord[]>();
  for (const record of records) {
    if (record.winner === 'white') whiteWins++;
    else if (record.winner === 'black') blackWins++;
    else draws++;
    whiteScore += scoreFor(record, 'white');

    const key = `${record.pairing}:${record.seed}`;
    const bucket = byPairing.get(key);
    if (bucket) bucket.push(record);
    else byPairing.set(key, [record]);
  }

  let mirroredGames = 0;
  let mirroredScore = 0;
  for (const bucket of byPairing.values()) {
    if (bucket.length !== 2) continue;
    const [a, b] = bucket as [MatchRecord, MatchRecord];
    if (a.white.id !== b.black.id || a.black.id !== b.white.id) continue;
    mirroredGames += 2;
    mirroredScore += scoreFor(a, 'white') + scoreFor(b, 'white');
  }

  return {
    games: records.length,
    whiteScore: wilson(whiteScore, records.length),
    whiteWins,
    blackWins,
    draws,
    mirroredGames,
    mirroredWhiteScore: wilson(mirroredScore, mirroredGames),
  };
}
