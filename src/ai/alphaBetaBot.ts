/**
 * AlphaBetaBot — iterative-deepening negamax with alpha-beta pruning.
 *
 * Runs entirely on the observation state the runner hands it, so it plans
 * without hidden information: unrevealed enemy traps do not exist in its
 * world and an unrevealed enemy hand casts nothing. (A future ISMCTS agent
 * would instead SAMPLE hidden states; the agent interface already permits
 * that — nothing here needs to change for it.)
 *
 * v1 keeps the classic core and skips the classic extras (quiescence,
 * killer/history, PVS) until profiling says they pay for themselves:
 *  - iterative deepening (depth 1..maxDepth, best move carried forward)
 *  - transposition table over the full gameplay hash
 *  - ordering: TT move first, then captures by victim value, quiets, spells
 *  - terminal scores dominate and prefer near wins / far losses
 *  - node budget so tests and tournaments stay deterministic (no clocks)
 */

import { isGameOver, type Color, type GameState } from '../engine';
import {
  actionKey,
  applyGameAction,
  generateLegalActions,
  tryApplyGameAction,
  type GameAction,
} from './actions';
import type { AgentContext, Chess2Agent } from './agent';
import {
  DEFAULT_WEIGHTS,
  evaluatePosition,
  materialValue,
  terminalScore,
  type EvaluationWeights,
} from './evaluation';
import { hashGameState } from './hash';

export interface SearchLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface AlphaBetaOptions extends SearchLimits {
  readonly id?: string;
  readonly weights?: EvaluationWeights;
  /** Cap on spell candidates per node (moves are never dropped). */
  readonly spellBranchLimit?: number;
}

interface TtEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  best: string | null;
}

const INFINITY_SCORE = 10_000_000;

export class AlphaBetaBot implements Chess2Agent {
  readonly id: string;
  private readonly weights: EvaluationWeights;
  private readonly maxDepth: number;
  private readonly maxNodes: number;
  private readonly spellBranchLimit: number;

  private table = new Map<string, TtEntry>();
  private nodes = 0;
  private aborted = false;

  constructor(options: AlphaBetaOptions = {}) {
    this.maxDepth = options.maxDepth ?? 2;
    this.maxNodes = options.maxNodes ?? 40_000;
    this.id = options.id ?? `alphabeta-d${this.maxDepth}`;
    this.weights = options.weights ?? DEFAULT_WEIGHTS;
    this.spellBranchLimit = options.spellBranchLimit ?? 12;
  }

  chooseAction(
    state: GameState,
    legalActions: readonly GameAction[],
    context: AgentContext,
  ): GameAction {
    if (legalActions.length === 1) return legalActions[0]!;

    // Fresh search per decision: the table must not leak between positions
    // reached by different real-game lines than the ones we searched.
    this.table = new Map();
    this.nodes = 0;
    this.aborted = false;

    const root = this.orderActions([...legalActions], null, context);
    let best: GameAction = root[0]!;

    for (let depth = 1; depth <= this.maxDepth; depth++) {
      let alpha = -INFINITY_SCORE;
      let depthBest: GameAction | null = null;

      // Previous iteration's best first makes deeper iterations prune well.
      const ordered = [
        best,
        ...root.filter((action) => actionKey(action) !== actionKey(best)),
      ];

      for (const action of ordered) {
        // Root actions come from the REAL game; one may be un-resolvable on
        // our observation (Recon reads the hidden hand). Score those as a
        // stand-pat: playable, never preferred over a concrete gain.
        const next = tryApplyGameAction(state, action);
        let score: number;
        if (next === null) {
          score = evaluatePosition(state, context.color, this.weights) - 1;
        } else {
          // A bonus phase keeps us on move: no negation, same window side.
          const handover = next.turn !== state.turn;
          const child = this.search(
            next,
            depth - 1,
            handover ? -INFINITY_SCORE : alpha,
            handover ? -alpha : INFINITY_SCORE,
            context.color,
            1,
          );
          score = handover ? -child : child;
        }
        if (this.aborted) break;
        if (score > alpha) {
          alpha = score;
          depthBest = action;
        }
      }

      if (this.aborted) break; // keep the last fully-searched depth's answer
      if (depthBest) best = depthBest;
    }

    return best;
  }

  /** Negamax over "the player to move" with the score from that player's view. */
  private search(
    state: GameState,
    depth: number,
    alpha: number,
    beta: number,
    rootColor: Color,
    ply: number,
  ): number {
    if (this.aborted) return 0;
    if (++this.nodes > this.maxNodes) {
      this.aborted = true;
      return 0;
    }

    const mover = state.turn;
    const sign = mover === rootColor ? 1 : -1;

    if (isGameOver(state)) return sign * terminalScore(state, rootColor, ply);
    if (depth === 0) return sign * evaluatePosition(state, rootColor, this.weights);

    const key = hashGameState(state);
    const cached = this.table.get(key);
    if (cached && cached.depth >= depth) {
      if (cached.flag === 'exact') return cached.score;
      if (cached.flag === 'lower' && cached.score >= beta) return cached.score;
      if (cached.flag === 'upper' && cached.score <= alpha) return cached.score;
    }

    const actions = this.orderActions(generateLegalActions(state), cached?.best ?? null, null);
    if (actions.length === 0) return sign * terminalScore(state, rootColor, ply);

    const originalAlpha = alpha;
    let bestScore = -INFINITY_SCORE;
    let bestKey: string | null = null;

    for (const action of actions) {
      const next = applyGameAction(state, action);
      // A bonus phase keeps the same side to move; negate only on handover.
      const handover = next.turn !== mover;
      const child = this.search(
        next,
        depth - 1,
        handover ? -beta : alpha,
        handover ? -alpha : beta,
        rootColor,
        ply + 1,
      );
      const score = handover ? -child : child;
      if (this.aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestKey = actionKey(action);
      }
      if (bestScore > alpha) alpha = bestScore;
      if (alpha >= beta) break;
    }

    this.table.set(key, {
      depth,
      score: bestScore,
      flag: bestScore <= originalAlpha ? 'upper' : bestScore >= beta ? 'lower' : 'exact',
      best: bestKey,
    });
    return bestScore;
  }

  /** TT move first, then captures by victim value, quiets, spells last. */
  private orderActions(
    actions: GameAction[],
    preferredKey: string | null,
    context: AgentContext | null,
  ): GameAction[] {
    const spells = actions.filter((action) => action.kind === 'spell');
    const rest = actions.filter((action) => action.kind !== 'spell');

    const scored = rest.map((action) => ({
      action,
      score:
        action.kind === 'move' && action.move.captured
          ? 1000 + materialValue(action.move.captured.type)
          : 0,
    }));
    scored.sort((a, b) => b.score - a.score);

    const keptSpells =
      spells.length > this.spellBranchLimit
        ? (context ? context.rng.shuffle(spells) : spells).slice(0, this.spellBranchLimit)
        : spells;

    const ordered = [...scored.map((entry) => entry.action), ...keptSpells];
    if (!preferredKey) return ordered;
    const preferred = ordered.find((action) => actionKey(action) === preferredKey);
    if (!preferred) return ordered;
    return [preferred, ...ordered.filter((action) => action !== preferred)];
  }
}
