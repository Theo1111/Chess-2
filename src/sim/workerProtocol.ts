/**
 * The message contract between the parallel tournament runner and its
 * workers. Everything crossing the thread boundary is plain structured-clone
 * data: agent SPECS rather than agent instances, serialized rosters, and
 * finished match records.
 */

import type { Roster } from '../roster';
import type { AgentSpec } from '../ai/agentFactory';
import type { CostOverrides } from '../balance/overrides';
import type { FailureRecord, MatchRecord } from './tournament';

export interface WorkerJob {
  readonly seed: number;
  readonly games: number;
  readonly mirrored: boolean;
  readonly maxPlies?: number;
  readonly collectTelemetry?: boolean;
  readonly agents: readonly AgentSpec[];
  readonly armies: readonly Roster[];
  /** Applied INSIDE the worker's own registry; never touches other workers. */
  readonly overrides?: CostOverrides;
  /** The pairing indices this worker owns. */
  readonly pairings: readonly number[];
}

export type WorkerMessage =
  | { readonly type: 'batch'; readonly records: MatchRecord[]; readonly failures: FailureRecord[] }
  | { readonly type: 'done' };
