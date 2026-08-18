/**
 * The marginal-value model: L2-regularized logistic regression.
 *
 *   P(white wins) = sigmoid( b0
 *                          + Σ piece_coef  × (white copies − black copies)
 *                          + Σ card_coef   × (white has    − black has) )
 *
 * b0 is the first-move term — every row is oriented white-first, so the
 * intercept absorbs exactly that advantage. Draws train as a 0.5 label,
 * which plain gradient-descent logistic regression accepts happily.
 *
 * Trained by full-batch gradient descent: deterministic, dependency-free,
 * and comfortably fast at this feature count (dozens) even on 100k rows.
 * Coefficients are DIAGNOSTIC SIGNALS about balance, not truths about
 * correct costs — reporting phrases them accordingly.
 */

import type { MatchRecord } from '../sim/tournament';

export interface ModelConfig {
  readonly iterations?: number;
  readonly learningRate?: number;
  readonly l2?: number;
}

export interface BalanceModel {
  readonly intercept: number;
  readonly pieces: ReadonlyMap<string, number>;
  readonly spells: ReadonlyMap<string, number>;
  readonly traps: ReadonlyMap<string, number>;
  readonly rows: number;
  /**
   * Approximate standard errors from the inverse of the penalized Hessian at
   * the fitted weights — the usual logistic-regression asymptotics. Keyed
   * like the coefficient maps, plus 'intercept'.
   */
  readonly standardErrors: ReadonlyMap<string, number>;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

interface Row {
  readonly features: Map<string, number>;
  readonly label: number;
}

function buildRows(records: readonly MatchRecord[]): { rows: Row[]; features: Set<string> } {
  const features = new Set<string>();
  const rows: Row[] = [];
  for (const record of records) {
    const row = new Map<string, number>();
    const add = (key: string, delta: number) => {
      features.add(key);
      row.set(key, (row.get(key) ?? 0) + delta);
    };

    for (const [piece, count] of Object.entries(record.white.composition)) {
      if (piece === 'king') continue;
      add(`p:${piece}`, count);
    }
    for (const [piece, count] of Object.entries(record.black.composition)) {
      if (piece === 'king') continue;
      add(`p:${piece}`, -count);
    }
    for (const card of record.white.spells) add(`s:${card}`, 1);
    for (const card of record.black.spells) add(`s:${card}`, -1);
    for (const card of record.white.traps) add(`t:${card}`, 1);
    for (const card of record.black.traps) add(`t:${card}`, -1);

    rows.push({
      features: row,
      label: record.winner === 'draw' ? 0.5 : record.winner === 'white' ? 1 : 0,
    });
  }
  return { rows, features };
}

export function fitBalanceModel(
  records: readonly MatchRecord[],
  config: ModelConfig = {},
): BalanceModel {
  const iterations = config.iterations ?? 400;
  const learningRate = config.learningRate ?? 0.05;
  const l2 = config.l2 ?? 0.01;

  const { rows, features } = buildRows(records);
  const keys = [...features].sort();
  const weights = new Map<string, number>(keys.map((key) => [key, 0]));
  let intercept = 0;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradients = new Map<string, number>(keys.map((key) => [key, 0]));
    let interceptGradient = 0;

    for (const row of rows) {
      let z = intercept;
      for (const [key, value] of row.features) z += (weights.get(key) ?? 0) * value;
      const error = sigmoid(z) - row.label;
      interceptGradient += error;
      for (const [key, value] of row.features) {
        gradients.set(key, gradients.get(key)! + error * value);
      }
    }

    const scale = rows.length > 0 ? learningRate / rows.length : 0;
    intercept -= scale * interceptGradient;
    for (const key of keys) {
      const gradient = gradients.get(key)! + l2 * weights.get(key)! * rows.length;
      weights.set(key, weights.get(key)! - scale * gradient);
    }
  }

  const pick = (prefix: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [key, value] of weights) {
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), value);
    }
    return out;
  };

  const standardErrors = computeStandardErrors(rows, keys, weights, intercept, l2);

  return {
    intercept,
    pieces: pick('p:'),
    spells: pick('s:'),
    traps: pick('t:'),
    rows: rows.length,
    standardErrors,
  };
}

/**
 * SEs via the penalized observed information matrix:
 *   H = Σ_i p_i(1-p_i) x_i x_iᵀ  +  λ·n·I   (no penalty on the intercept)
 *   SE_j = sqrt( (H⁻¹)_jj )
 * Feature vectors are sparse (an army touches a couple of dozen features), so
 * H accumulates over per-row feature pairs; the dense inversion is tiny.
 */
function computeStandardErrors(
  rows: readonly Row[],
  keys: readonly string[],
  weights: ReadonlyMap<string, number>,
  intercept: number,
  l2: number,
): Map<string, number> {
  const size = keys.length + 1; // slot 0 = intercept
  const slot = new Map<string, number>(keys.map((key, index) => [key, index + 1]));
  const hessian: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (const row of rows) {
    let z = intercept;
    for (const [key, value] of row.features) z += (weights.get(key) ?? 0) * value;
    const p = sigmoid(z);
    const w = p * (1 - p);
    const entries: [number, number][] = [[0, 1]];
    for (const [key, value] of row.features) entries.push([slot.get(key)!, value]);
    for (const [j, xj] of entries) {
      for (const [k, xk] of entries) hessian[j]![k]! += w * xj * xk;
    }
  }
  for (let j = 1; j < size; j++) hessian[j]![j]! += l2 * rows.length;

  const inverse = invertMatrix(hessian);
  const errors = new Map<string, number>();
  const diagonal = (index: number): number => {
    const value = inverse?.[index]?.[index];
    return value !== undefined && value > 0 ? Math.sqrt(value) : Number.POSITIVE_INFINITY;
  };
  errors.set('intercept', diagonal(0));
  for (const [key, index] of slot) errors.set(key, diagonal(index));
  return errors;
}

/** Gauss–Jordan with partial pivoting. Returns null for a singular matrix. */
function invertMatrix(matrix: readonly (readonly number[])[]): number[][] | null {
  const size = matrix.length;
  const work = matrix.map((row, index) => [
    ...row,
    ...Array.from({ length: size }, (_, j) => (j === index ? 1 : 0)),
  ]);

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(work[row]![column]!) > Math.abs(work[pivot]![column]!)) pivot = row;
    }
    const pivotValue = work[pivot]![column]!;
    if (Math.abs(pivotValue) < 1e-12) return null;
    if (pivot !== column) {
      const tmp = work[pivot]!;
      work[pivot] = work[column]!;
      work[column] = tmp;
    }
    const lead = work[column]!;
    for (let j = 0; j < 2 * size; j++) lead[j]! /= pivotValue;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = work[row]![column]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * size; j++) work[row]![j]! -= factor * lead[j]!;
    }
  }
  return work.map((row) => row.slice(size));
}

export interface EfficiencyEntry {
  readonly piece: string;
  readonly cost: number;
  readonly coefficient: number;
  /** coefficient per point, scaled so the piece-pool mean is 1.0. */
  readonly relativeEfficiency: number;
  /**
   * Marginal effect of one extra copy in percentage points of win
   * probability, evaluated at the model's baseline (the intercept), with a
   * 95% interval from the coefficient's standard error.
   */
  readonly effectPp: number;
  readonly effectLowPp: number;
  readonly effectHighPp: number;
}

/** Coefficient → percentage-point swing at the model's baseline. */
export function coefficientToPp(model: BalanceModel, coefficient: number): number {
  return (sigmoid(model.intercept + coefficient) - sigmoid(model.intercept)) * 100;
}

/**
 * Value-per-point: each coefficient divided by the piece's cost, normalized
 * to a mean of 1 so "1.2" reads as "20% above the average piece". Outliers
 * on either side are the investigation candidates.
 */
export function pieceEfficiency(
  model: BalanceModel,
  costOf: (piece: string) => number,
): EfficiencyEntry[] {
  const raw = [...model.pieces.entries()].map(([piece, coefficient]) => ({
    piece,
    cost: costOf(piece),
    coefficient,
    perPoint: coefficient / Math.max(1, costOf(piece)),
  }));
  if (raw.length === 0) return [];
  const meanAbs =
    raw.reduce((total, entry) => total + Math.abs(entry.perPoint), 0) / raw.length || 1;
  return raw
    .map(({ piece, cost, coefficient, perPoint }) => {
      const se = model.standardErrors.get(`p:${piece}`) ?? Number.POSITIVE_INFINITY;
      const margin = Number.isFinite(se) ? 1.96 * se : Number.POSITIVE_INFINITY;
      return {
        piece,
        cost,
        coefficient,
        relativeEfficiency: perPoint / meanAbs,
        effectPp: coefficientToPp(model, coefficient),
        effectLowPp: Number.isFinite(margin)
          ? coefficientToPp(model, coefficient - margin)
          : -100,
        effectHighPp: Number.isFinite(margin)
          ? coefficientToPp(model, coefficient + margin)
          : 100,
      };
    })
    .sort((a, b) => b.relativeEfficiency - a.relativeEfficiency);
}

/** Predicted P(white wins) for a record under the model — used by synergy. */
export function predict(model: BalanceModel, record: MatchRecord): number {
  let z = model.intercept;
  for (const [piece, count] of Object.entries(record.white.composition)) {
    if (piece !== 'king') z += (model.pieces.get(piece) ?? 0) * count;
  }
  for (const [piece, count] of Object.entries(record.black.composition)) {
    if (piece !== 'king') z -= (model.pieces.get(piece) ?? 0) * count;
  }
  for (const card of record.white.spells) z += model.spells.get(card) ?? 0;
  for (const card of record.black.spells) z -= model.spells.get(card) ?? 0;
  for (const card of record.white.traps) z += model.traps.get(card) ?? 0;
  for (const card of record.black.traps) z -= model.traps.get(card) ?? 0;
  return sigmoid(z);
}
