/**
 * FEN (Forsyth–Edwards Notation) serialization.
 *
 * FEN is the engine's canonical position format: it powers repetition
 * detection, test fixtures and — later — saved games and replays.
 */

import { BOARD_SIZE, FILE_COUNT, RANK_COUNT, makeSquare, parseSquareName, squareName } from './board';
import { createPiece } from './apply';
import { NO_CASTLING_RIGHTS } from './castling';
import { allPieceDefinitions, getPieceDefinition } from './pieces';
import type { Board, CastlingRights, Color, GameState, Piece, PieceType, Square } from './types';

export const START_FEN =
  'rnbqkqbnr/ppppppppp/9/9/9/9/9/PPPPPPPPP/RNBQKQBNR w KQkq - 0 1';

/**
 * Repetition key: the position part of a FEN (board, turn, castling, en
 * passant) plus the Chess 2 state that FEN cannot express — whose free move is
 * pending, and any damaged pieces. Two positions that differ in those are not
 * the same position.
 */
export function positionKey(state: GameState): string {
  const base = toFen(state).split(' ').slice(0, 4).join(' ');
  const damaged: string[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (piece?.hitPoints !== undefined) damaged.push(`${square}:${piece.hitPoints}`);
  }
  const phase = state.phase === 'bonus' ? ' bonus' : '';
  const hp = damaged.length ? ` hp[${damaged.join(',')}]` : '';
  const ambush = state.ambush
    ? ` amb[${state.ambush.path.join('.')}>${state.ambush.victim}]`
    : '';
  const effects = state.effects.length
    ? ` fx[${state.effects
        .map(
          (effect) =>
            `${effect.kind}:${effect.targetPieceId}:${effect.expiresAtTurnStartOf?.[0] ?? '-'}` +
            (effect.turnsRemaining === undefined ? '' : `:${effect.turnsRemaining}`),
        )
        .sort()
        .join(',')}]`
    : '';
  // Remaining spells change the legal actions available, so two positions
  // with different books are not repetitions of each other.
  const spells =
    state.spells.white.available.length || state.spells.black.available.length
      ? ` sp[${state.spells.white.available.join('.')}|${state.spells.black.available.join('.')}]`
      : '';
  const order = state.pawnOrder ? ` po[${state.pawnOrder.color[0]}${state.pawnOrder.stage[0]}]` : '';
  const traps = state.traps.length
    ? ` tr[${state.traps
        .map((t) => `${t.trap}:${t.square}:${t.armed ? 'a' : 'x'}${t.revealed ? 'r' : ''}${t.pendingPieceId ?? ''}`)
        .sort()
        .join(',')}]`
    : '';
  const regions = state.regions.length
    ? ` rg[${state.regions.map((r) => `${r.kind}:${r.center}:${r.pliesRemaining}`).sort().join(',')}]`
    : '';
  const terrain = state.squareStatuses.length
    ? ` st[${state.squareStatuses.map((t) => `${t.kind}:${t.square}:${t.pliesRemaining}`).sort().join(',')}]`
    : '';
  return `${base}${phase}${hp}${ambush}${effects}${spells}${order}${traps}${regions}${terrain}`;
}

function symbolFor(piece: Piece): string {
  const symbol = getPieceDefinition(piece.type).symbol;
  return piece.color === 'white' ? symbol.toUpperCase() : symbol.toLowerCase();
}

function typeForSymbol(symbol: string): PieceType | null {
  const lower = symbol.toLowerCase();
  for (const definition of allPieceDefinitions()) {
    if (definition.symbol === lower) return definition.type;
  }
  return null;
}

export function boardToFen(board: Board): string {
  const ranks: string[] = [];
  for (let rank = RANK_COUNT - 1; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < FILE_COUNT; file++) {
      const piece = board[makeSquare(file, rank)];
      if (piece) {
        if (empty) row += String(empty);
        empty = 0;
        row += symbolFor(piece);
      } else {
        empty++;
      }
    }
    if (empty) row += String(empty);
    ranks.push(row);
  }
  return ranks.join('/');
}

export function castlingToFen(rights: CastlingRights): string {
  const text =
    (rights.whiteKingside ? 'K' : '') +
    (rights.whiteQueenside ? 'Q' : '') +
    (rights.blackKingside ? 'k' : '') +
    (rights.blackQueenside ? 'q' : '');
  return text || '-';
}

export function toFen(state: GameState): string {
  return [
    boardToFen(state.board),
    state.turn === 'white' ? 'w' : 'b',
    castlingToFen(state.castling),
    state.enPassant === null ? '-' : squareName(state.enPassant),
    String(state.halfmoveClock),
    String(state.fullmoveNumber),
  ].join(' ');
}

export interface ParsedFen {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  enPassant: Square | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

export function parseFen(fen: string): ParsedFen {
  const parts = fen.trim().split(/\s+/);
  const [placement, turnField, castlingField, enPassantField, halfmoveField, fullmoveField] = parts;
  if (!placement || !turnField) throw new Error(`Invalid FEN: ${fen}`);

  const board: (Piece | null)[] = new Array<Piece | null>(FILE_COUNT * RANK_COUNT).fill(null);
  const rows = placement.split('/');
  if (rows.length !== RANK_COUNT) throw new Error(`Invalid FEN board: ${placement}`);

  // Track duplicates so generated piece ids stay unique and deterministic.
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const rank = RANK_COUNT - 1 - index;
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) {
        file += Number(char);
        continue;
      }
      const type = typeForSymbol(char);
      if (!type) throw new Error(`Unknown FEN piece: ${char}`);
      const color: Color = char === char.toUpperCase() ? 'white' : 'black';
      const square = makeSquare(file, rank);
      const key = `${color}-${type}-${square}`;
      const seq = seen.get(key) ?? 0;
      seen.set(key, seq + 1);
      board[square] = createPiece(color, type, square, seq);
      file++;
    }
  });

  const castling: CastlingRights = {
    ...NO_CASTLING_RIGHTS,
    whiteKingside: castlingField?.includes('K') ?? false,
    whiteQueenside: castlingField?.includes('Q') ?? false,
    blackKingside: castlingField?.includes('k') ?? false,
    blackQueenside: castlingField?.includes('q') ?? false,
  };

  return {
    board,
    turn: turnField === 'b' ? 'black' : 'white',
    castling,
    enPassant: enPassantField && enPassantField !== '-' ? parseSquareName(enPassantField) : null,
    halfmoveClock: Number(halfmoveField ?? 0) || 0,
    fullmoveNumber: Number(fullmoveField ?? 1) || 1,
  };
}
