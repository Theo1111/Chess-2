/**
 * Serializable agent specifications.
 *
 * Worker threads cannot receive class instances, so tournaments describe
 * their bots as plain data and every executor — main thread or worker —
 * builds identical agents from the same spec. The spec is also what gets
 * recorded in run configs, so a report always names its exact bot settings.
 */

import type { Chess2Agent } from './agent';
import { RandomBot } from './randomBot';
import { GreedyBot } from './greedyBot';
import { AlphaBetaBot } from './alphaBetaBot';

export type AgentSpec =
  | { readonly kind: 'random'; readonly id?: string }
  | { readonly kind: 'greedy'; readonly id?: string; readonly sampleLimit?: number }
  | {
      readonly kind: 'alphabeta';
      readonly id?: string;
      readonly maxDepth?: number;
      readonly maxNodes?: number;
    };

export function buildAgent(spec: AgentSpec): Chess2Agent {
  switch (spec.kind) {
    case 'random':
      return new RandomBot(spec.id ?? 'random');
    case 'greedy':
      return new GreedyBot({
        ...(spec.id !== undefined ? { id: spec.id } : {}),
        ...(spec.sampleLimit !== undefined ? { sampleLimit: spec.sampleLimit } : {}),
      });
    case 'alphabeta':
      return new AlphaBetaBot({
        ...(spec.id !== undefined ? { id: spec.id } : {}),
        ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
        ...(spec.maxNodes !== undefined ? { maxNodes: spec.maxNodes } : {}),
      });
  }
}

export const buildAgents = (specs: readonly AgentSpec[]): Chess2Agent[] => specs.map(buildAgent);
