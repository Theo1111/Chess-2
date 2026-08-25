/**
 * The roster layer: armies, budgets, deployment and validation.
 *
 * Depends on the engine (for piece definitions and board types) but never the
 * other way round — the engine plays whatever board it is handed.
 */

export * from './types';
export * from './availability';
export * from './catalog';
export * from './roster';
export * from './validation';
export * from './loadout';
export * from './setup';
