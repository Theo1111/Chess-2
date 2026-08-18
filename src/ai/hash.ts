/**
 * Stable gameplay hash of a `GameState`, for transposition tables.
 *
 * Everything rule-relevant is folded in: board occupancy (via positionKey),
 * per-piece hit points and origins, phase, pools, effects, traps, regions,
 * square statuses, spell books and pending bonus state. Nothing visual is.
 *
 * Known, documented approximation: `positionCounts` (threefold history) is
 * NOT hashed — folding the whole repetition table in would make almost every
 * node unique and the table useless. A shallow search may therefore misjudge
 * a position that is one repetition away from a draw.
 */

import { positionKey, type GameState } from '../engine';

export function hashGameState(state: GameState): string {
  const parts: string[] = [positionKey(state), state.phase, String(state.halfmoveClock)];

  // Piece-attached state that FEN cannot see.
  for (let square = 0; square < state.board.length; square++) {
    const piece = state.board[square];
    if (!piece) continue;
    if ((piece.hitPoints ?? 1) > 1) parts.push(`hp${square}:${piece.hitPoints}`);
    if (piece.origin !== undefined && piece.origin !== piece.type) {
      parts.push(`or${square}:${piece.origin}`);
    }
  }

  if (state.ambush) parts.push(`am${state.ambush.victim}:${state.ambush.path.join('.')}`);
  if (state.pawnOrder) parts.push(`po${state.pawnOrder.color[0]}${state.pawnOrder.stage[0]}`);

  for (const color of ['white', 'black'] as const) {
    const book = state.spells[color];
    parts.push(`${color[0]}s:${[...book.available].sort().join('.')}:${book.revealed ? 'R' : ''}`);
    parts.push(`${color[0]}r:${[...state.reserves[color]].sort().join('.')}`);
    parts.push(`${color[0]}c:${[...state.captured[color]].sort().join('.')}`);
  }

  for (const effect of state.effects) parts.push(`e${effect.kind}:${effect.targetPieceId}`);
  for (const trap of state.traps) {
    parts.push(`t${trap.trap}:${trap.square}:${trap.owner[0]}${trap.revealed ? 'R' : ''}${trap.armed ? 'A' : ''}`);
  }
  for (const region of state.regions) {
    parts.push(`g${region.kind}:${region.center}:${region.pliesRemaining}`);
  }
  for (const status of state.squareStatuses) {
    parts.push(`q${status.kind}:${status.square}:${status.pliesRemaining}`);
  }

  return fnv64(parts.join('|'));
}

/** Two interleaved FNV-1a streams → 64 bits of key, hex-encoded. */
function fnv64(text: string): string {
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ ((code << 1) | 1), 16777619);
  }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
