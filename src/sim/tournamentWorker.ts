/**
 * Worker-thread entry point for parallel tournaments.
 *
 * Each worker is a fresh JS realm with its OWN piece/spell registries, so a
 * cost override applied here exists only in this worker for this job and can
 * never race another experiment. Pairing results are streamed back in small
 * batches so the main thread can aggregate-and-discard for huge runs.
 */

import { parentPort, workerData } from 'node:worker_threads';

// A fresh realm starts with empty registries — register everything first.
import '../engine/customPieces';
import '../engine/rookPieces';
import '../engine/knightPieces';
import '../engine/bishopPieces';

import { buildAgents } from '../ai/agentFactory';
import { withCostOverrides } from '../balance/overrides';
import { runTournamentBatch, type TournamentConfig } from './tournament';
import type { WorkerJob, WorkerMessage } from './workerProtocol';

const port = parentPort;
if (!port) throw new Error('tournamentWorker must run as a worker thread');

const job = workerData as WorkerJob;
const post = (message: WorkerMessage): void => port.postMessage(message);

const run = (): void => {
  const config: TournamentConfig = {
    games: job.games,
    agents: buildAgents(job.agents),
    armies: job.armies,
    seed: job.seed,
    mirrored: job.mirrored,
    ...(job.maxPlies !== undefined ? { maxPlies: job.maxPlies } : {}),
    ...(job.collectTelemetry !== undefined ? { collectTelemetry: job.collectTelemetry } : {}),
    keepRecords: true,
  };

  // Stream results in small chunks: memory stays flat on 50k-game runs and
  // the main thread can show progress.
  const CHUNK = 8;
  for (let start = 0; start < job.pairings.length; start += CHUNK) {
    const slice = job.pairings.slice(start, start + CHUNK);
    const batch = runTournamentBatch(config, slice);
    post({ type: 'batch', records: batch.records, failures: batch.failures });
  }
};

if (job.overrides && Object.keys(job.overrides).length > 0) {
  withCostOverrides(job.overrides, run);
} else {
  run();
}

post({ type: 'done' });
