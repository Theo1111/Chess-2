import type { Board, Color, Piece, PieceType, Square } from './types';

export const FILE_COUNT = 9;
export const RANK_COUNT = 9;
export const BOARD_SIZE = FILE_COUNT * RANK_COUNT;

export const FILE_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;

export const fileOf = (square: Square): number => square % FILE_COUNT;
export const rankOf = (square: Square): number => Math.floor(square / FILE_COUNT);

export const makeSquare = (file: number, rank: number): Square => rank * FILE_COUNT + file;

export const isInside = (file: number, rank: number): boolean =>
  file >= 0 && file < FILE_COUNT && rank >= 0 && rank < RANK_COUNT;

export const isSquare = (square: number): boolean => square >= 0 && square < BOARD_SIZE;

/** "e4" style name for a square index. */
export const squareName = (square: Square): string =>
  `${FILE_NAMES[fileOf(square)]}${rankOf(square) + 1}`;

/** Inverse of {@link squareName}. Returns null for malformed input. */
export function parseSquareName(name: string): Square | null {
  if (name.length !== 2) return null;
  const file = FILE_NAMES.indexOf(name[0] as (typeof FILE_NAMES)[number]);
  const rank = Number(name[1]) - 1;
  if (file < 0 || !Number.isInteger(rank) || !isInside(file, rank)) return null;
  return makeSquare(file, rank);
}

/** Rank index a colour's pawns move toward (+1 for white, -1 for black). */
export const forwardDirection = (color: Color): number => (color === 'white' ? 1 : -1);

/** Rank a colour's pawns start on. */
export const pawnStartRank = (color: Color): number =>
  color === 'white' ? 1 : RANK_COUNT - 2;

/** Rank a colour's pawns promote on. */
export const promotionRank = (color: Color): number =>
  color === 'white' ? RANK_COUNT - 1 : 0;

export const pieceAt = (board: Board, square: Square): Piece | null => board[square] ?? null;

export const emptyBoard = (): Board => new Array<Piece | null>(BOARD_SIZE).fill(null);

/**
 * Deterministic piece id. Ids exist for UI identity only; they are derived from
 * data already in the position, never from randomness or wall-clock time.
 */
export const makePieceId = (color: Color, type: PieceType, square: Square, seq = 0): string =>
  `${color[0]}${type}-${squareName(square)}${seq ? `-${seq}` : ''}`;

export const makePiece = (color: Color, type: PieceType, square: Square, seq = 0): Piece => ({
  type,
  color,
  id: makePieceId(color, type, square, seq),
});

/**
 * Squares strictly between two squares that lie on one orthogonal or diagonal
 * line — the squares a straight mover (or leaper such as the Diplomat, Ram or
 * a double-pushing pawn) passes over. Empty for knight-shaped moves.
 */
export function straightPath(from: Square, to: Square): Square[] {
  const deltaFile = fileOf(to) - fileOf(from);
  const deltaRank = rankOf(to) - rankOf(from);
  const straight =
    deltaFile === 0 || deltaRank === 0 || Math.abs(deltaFile) === Math.abs(deltaRank);
  if (!straight || (deltaFile === 0 && deltaRank === 0)) return [];

  const steps = Math.max(Math.abs(deltaFile), Math.abs(deltaRank));
  const stepFile = Math.sign(deltaFile);
  const stepRank = Math.sign(deltaRank);
  const path: Square[] = [];
  for (let step = 1; step < steps; step++) {
    path.push(makeSquare(fileOf(from) + stepFile * step, rankOf(from) + stepRank * step));
  }
  return path;
}

/** Locate the first square holding a piece of the given type and colour. */
export function findPiece(board: Board, color: Color, type: PieceType): Square | null {
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (piece && piece.color === color && piece.type === type) return square;
  }
  return null;
}
