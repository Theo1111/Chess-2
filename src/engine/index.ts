/**
 * Public surface of the chess engine.
 *
 * The engine is pure TypeScript with no React/DOM dependency — it can be run
 * in tests, a worker, a server or an AI search loop unchanged.
 */

export * from './types';
export * from './board';
export * from './pieces';
export * from './abilities';
export * from './customPieces';
export * from './rookPieces';
export * from './knightPieces';
export * from './bishopPieces';
export * from './captureRules';
export * from './effects';
export * from './boardEffects';
export * from './traps';
export * from './spells';
export * from './auras';
export * from './patterns';
export * from './specialMoves';
export * from './castling';
export * from './attacks';
export * from './apply';
export * from './moveGeneration';
export * from './notation';
export * from './fen';
export * from './game';
