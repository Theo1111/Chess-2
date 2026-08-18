/**
 * Parallel tournament execution over worker threads.
 *
 * Reproducibility rules:
 *  - every pairing derives armies, agents and its match seed purely from
 *    (masterSeed, pairingIndex) — proven by the partition-equivalence test;
 *  - pairings are dealt to workers round-robin, but since a pairing's result
 *    is scheduling-independent, ANY worker count yields the same records;
 *  - ratings and aggregates are computed in one canonical post-pass
 *    (`finalizeTournament`), never during play.
 *
 * So `--workers 1` and `--workers 8` produce numerically identical results,
 * and `--workers 1` (the in-process path, no threads at all) remains the
 * reference implementation.
 */

import { Worker } from 'node:worker_threads';
import { buildAgents, type AgentSpec } from '../ai/agentFactory';
import { withCostOverrides, type CostOverrides } from '../balance/overrides';
import type { Roster } from '../roster';
import {
  finalizeTournament,
  runTournament,
  totalPairings,
  type FailureRecord,
  type MatchRecord,
  type TournamentResult,
} from './tournament';
import type { WorkerJob, WorkerMessage } from './workerProtocol';

export interface ParallelTournamentConfig {
  readonly games: number;
  readonly seed: number;
  readonly agents: readonly AgentSpec[];
  readonly armies: readonly Roster[];
  readonly workers: number;
  readonly mirrored?: boolean;
  readonly maxPlies?: number;
  readonly collectTelemetry?: boolean;
  /** false = strip per-event telemetry after onRecord (for huge runs). */
  readonly keepRecords?: boolean;
  readonly overrides?: CostOverrides;
  readonly onRecord?: (record: MatchRecord) => void;
  /** Abort the whole run on the first worker crash. Default: keep going. */
  readonly failFast?: boolean;
}

/** Round-robin deal of pairing indices across `workers` hands. */
export function partitionPairings(pairingCount: number, workers: number): number[][] {
  const partitions: number[][] = Array.from({ length: workers }, () => []);
  for (let pairing = 0; pairing < pairingCount; pairing++) {
    partitions[pairing % workers]!.push(pairing);
  }
  return partitions.filter((partition) => partition.length > 0);
}

export async function runParallelTournament(
  config: ParallelTournamentConfig,
): Promise<TournamentResult> {
  const mirrored = config.mirrored ?? true;
  const keepRecords = config.keepRecords ?? true;

  // The reference path: no threads, overrides wrap the run in-process.
  if (config.workers <= 1) {
    const execute = (): TournamentResult =>
      runTournament({
        games: config.games,
        agents: buildAgents(config.agents),
        armies: config.armies,
        seed: config.seed,
        mirrored,
        ...(config.maxPlies !== undefined ? { maxPlies: config.maxPlies } : {}),
        ...(config.collectTelemetry !== undefined
          ? { collectTelemetry: config.collectTelemetry }
          : {}),
        keepRecords,
        ...(config.onRecord ? { onRecord: config.onRecord } : {}),
      });
    return config.overrides && Object.keys(config.overrides).length > 0
      ? withCostOverrides(config.overrides, execute)
      : execute();
  }

  const partitions = partitionPairings(totalPairings(config.games, mirrored), config.workers);
  const records: MatchRecord[] = [];
  const failures: FailureRecord[] = [];

  await Promise.all(
    partitions.map(
      (pairings, workerIndex) =>
        new Promise<void>((resolve, reject) => {
          const job: WorkerJob = {
            seed: config.seed,
            games: config.games,
            mirrored,
            ...(config.maxPlies !== undefined ? { maxPlies: config.maxPlies } : {}),
            ...(config.collectTelemetry !== undefined
              ? { collectTelemetry: config.collectTelemetry }
              : {}),
            agents: config.agents,
            armies: config.armies,
            ...(config.overrides ? { overrides: config.overrides } : {}),
            pairings,
          };

          const worker = new Worker(new URL('./tournamentWorker.ts', import.meta.url), {
            workerData: job,
          });
          let finished = false;

          worker.on('message', (message: WorkerMessage) => {
            if (message.type === 'batch') {
              for (const record of message.records) {
                config.onRecord?.(record);
                records.push(keepRecords ? record : { ...record, telemetry: null });
              }
              failures.push(...message.failures);
            } else {
              finished = true;
              void worker.terminate();
              resolve();
            }
          });

          const crash = (error: Error): void => {
            if (finished) return;
            finished = true;
            // Data integrity first: record the crash with everything known.
            failures.push({
              pairing: -1,
              seed: config.seed,
              ply: -1,
              fen: `<worker ${workerIndex} crashed; owned pairings ${pairings[0]}..${pairings[pairings.length - 1]}>`,
              whiteArmy: '<unknown>',
              blackArmy: '<unknown>',
              whiteAgent: config.agents[0]?.kind ?? '<unknown>',
              blackAgent: config.agents[0]?.kind ?? '<unknown>',
              error: error.message,
              ...(error.stack ? { stack: error.stack } : {}),
              actions: [],
            });
            void worker.terminate();
            if (config.failFast) reject(error);
            else resolve();
          };

          worker.on('error', crash);
          worker.on('exit', (code) => {
            if (!finished && code !== 0) crash(new Error(`worker exited with code ${code}`));
          });
        }),
    ),
  );

  return finalizeTournament(records, failures);
}
