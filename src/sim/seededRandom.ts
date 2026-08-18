/**
 * Deterministic randomness for simulation.
 *
 * Every source of chance in the balance laboratory flows through a `SeededRng`
 * so that a run is a pure function of its seed: the same seed, agents and
 * armies replay the same games byte for byte. Simulation code must never call
 * `Math.random()` directly.
 *
 * The generator is mulberry32 — tiny, fast, and plenty for game simulation
 * (this is not cryptography). `child()` derives independent streams so that,
 * for example, each match in a tournament gets its own RNG and inserting a new
 * match does not shift every later one.
 */

export interface SeededRng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). `bound` must be a positive integer. */
  int(bound: number): number;
  /** Uniformly chosen element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** New array, uniformly shuffled (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream derived from this seed and a label. */
  child(label: string | number): SeededRng;
  /** The seed this stream was created from, for logs and reproduction. */
  readonly seed: number;
}

/** FNV-1a over a string, for deriving child seeds from labels. */
function hashLabel(seed: number, label: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: seed >>> 0,
    next,
    int(bound: number): number {
      if (!Number.isInteger(bound) || bound <= 0) {
        throw new Error(`rng.int bound must be a positive integer, got ${bound}`);
      }
      return Math.floor(next() * bound);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(next() * (index + 1));
        const tmp = result[index]!;
        result[index] = result[swap]!;
        result[swap] = tmp;
      }
      return result;
    },
    child(label: string | number): SeededRng {
      return createRng(hashLabel(seed >>> 0, String(label)));
    },
  };
}
