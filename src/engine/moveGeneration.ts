/**
 * Move generation.
 *
 * Two layers:
 *  - *pseudo-legal*: what a piece's definition (plus any active abilities) says
 *    it can do.
 *  - *legal*: pseudo-legal minus anything that leaves one's own king attacked,
 *    or that would remove one's own king from the board.
 *
 * Legality is checked by making the move on a scratch board and asking whether
 * any royal piece is under attack. That single rule covers pins, discovered
 * check, double check and en-passant discoveries without any special cases.
 */

import { findAbility, hasAbility } from './abilities';
import { applyMoveToBoard } from './apply';
import { effectivePatterns, isImmobilized } from './auras';
import { isSquareAttackedBy } from './attacks';
import { blockedSquares } from './boardEffects';
import { captureAllowed, classOfPiece } from './captureRules';
import { BOARD_SIZE, fileOf, makeSquare, promotionRank, rankOf } from './board';
import { walkPatterns } from './patterns';
import { getPieceDefinition, type MoveGenContext } from './pieces';
import type { Board, Color, GameState, Move, PieceType, Square } from './types';
import { opposite } from './types';

interface GenerateOptions {
  /** Skip special moves that can never be attacks (castling). */
  readonly attacksOnly?: boolean;
}

/** All moves the piece on `from` could make, ignoring king safety. */
export function generatePseudoLegalMovesFrom(
  state: GameState,
  from: Square,
  options: GenerateOptions = {},
): Move[] {
  const piece = state.board[from];
  if (!piece) return [];

  const definition = getPieceDefinition(piece.type);

  // Bonus windows: a Duelist free move, or a Royal Order pawn move.
  if (state.phase === 'bonus') {
    if (state.pawnOrder?.stage === 'active') {
      if (classOfPiece(piece.type) !== 'pawn') return [];
    } else if (!hasAbility(definition.abilities, 'extra-move')) {
      return [];
    }
  }
  // Trapped pieces do nothing at all.
  if (isImmobilized(state, from)) return [];
  // Piece-specific restrictions, e.g. the Warrior's cooldown.
  if (definition.canMove && !definition.canMove({ state, square: from, piece })) return [];

  const ctx: MoveGenContext = {
    state,
    from,
    color: piece.color,
    definition,
    attacksOnly: options.attacksOnly ?? false,
    isSquareAttacked: (square, defender) => isSquareAttackedBy(state, square, opposite(defender)),
  };

  const moves: Move[] = [];
  const blocked = blockedSquares(state);
  walkPatterns(
    state.board,
    from,
    piece.color,
    effectivePatterns(state, from, piece),
    (to, target, captureSquare) => {
      const victimSquare = captureSquare ?? to;
      if (target) {
        // Immunities: Monk/Pawn standoffs, the Shieldmaiden's forward shield.
        if (!captureAllowed(state, piece, from, target, victimSquare)) return;

        // A target with hit points to spare repels the attack instead of
        // falling — but only attackers that actually land on it can be
        // repelled. A ranged stab simply fails against armour.
        if ((target.hitPoints ?? 1) > 1) {
          if (victimSquare !== to) return;
          moves.push({ from, to, piece: piece.type, color: piece.color, repelled: true });
          return;
        }
      }
      moves.push({
        from,
        to,
        piece: piece.type,
        color: piece.color,
        ...(target
          ? {
              captured: {
                type: target.type,
                color: target.color,
                id: target.id,
                square: victimSquare,
              },
            }
          : {}),
      });
    },
    { blocked },
  );

  if (definition.generateSpecial) moves.push(...definition.generateSpecial(ctx));

  const transformed = definition.transformMoves ? definition.transformMoves(moves, ctx) : moves;
  return withAbilityVariants(dedupeByTarget(transformed), ctx);
}

/**
 * Patterns can overlap (the Infiltrator moves like a rook *and* a king), which
 * would otherwise offer the same destination twice.
 */
function dedupeByTarget(moves: readonly Move[]): Move[] {
  if (moves.length < 2) return [...moves];
  const seen = new Set<string>();
  const unique: Move[] = [];
  for (const move of moves) {
    const key = `${move.to}|${move.promotion ?? ''}|${move.special ?? ''}|${move.repelled ? 'r' : ''}|${move.captured?.square ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(move);
  }
  return unique;
}

/**
 * Ability-driven move decorations and variants. Each is opt-in through the
 * piece's ability list, so the engine never names a specific piece.
 */
function withAbilityVariants(moves: Move[], ctx: MoveGenContext): Move[] {
  const { definition, state, color, from } = ctx;
  const abilities = definition.abilities;
  if (!abilities?.length && state.phase !== 'bonus') return moves;

  let result = moves;

  // Diplomat: mark the enemy piece jumped over as changing allegiance.
  if (hasAbility(abilities, 'convert-jumped-enemies')) {
    result = result.map((move) => {
      const jumped = jumpedSquare(move.from, move.to);
      if (jumped === null) return move;
      const victim = state.board[jumped];
      if (!victim || victim.color === color) return move;
      if (getPieceDefinition(victim.type).royal) return move; // kings cannot be bought
      return { ...move, converts: [jumped] };
    });
  }

  // Revolutionary: offer the sacrifice-and-swap variant on the far back rank.
  if (hasAbility(abilities, 'defect-on-back-rank')) {
    const backRank = promotionRank(color);
    result = result.flatMap((move) =>
      rankOf(move.to) === backRank ? [move, { ...move, special: 'defect' as const }] : [move],
    );
  }

  // Chariot: offer the variant that returns a reserve piece to the vacated square.
  const returnAbility = findAbility(abilities, 'return-reserve-on-move');
  if (returnAbility && state.reserves[color].includes(returnAbility.pieceType)) {
    result = result.flatMap((move) => [
      move,
      { ...move, returns: { square: from, type: returnAbility.pieceType } },
    ]);
  }

  // Tag free moves so the turn machinery can tell them from the main move.
  if (state.phase === 'bonus') result = result.map((move) => ({ ...move, bonus: true }));

  return result;
}

/** The square jumped over by a straight two-square leap, if this is one. */
function jumpedSquare(from: Square, to: Square): Square | null {
  const deltaFile = fileOf(to) - fileOf(from);
  const deltaRank = rankOf(to) - rankOf(from);
  const isTwoStep = (delta: number) => delta === 0 || Math.abs(delta) === 2;
  if (!isTwoStep(deltaFile) || !isTwoStep(deltaRank)) return null;
  if (deltaFile === 0 && deltaRank === 0) return null;
  return makeSquare(fileOf(from) + deltaFile / 2, rankOf(from) + deltaRank / 2);
}

/** All pseudo-legal moves for a colour (defaults to the side to move). */
export function generatePseudoLegalMoves(state: GameState, color = state.turn): Move[] {
  const moves: Move[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (!piece || piece.color !== color) continue;
    moves.push(...generatePseudoLegalMovesFrom(state, square));
  }
  return moves;
}

/** Squares holding royal (king-like) pieces of a colour. */
export function royalSquares(board: Board, color: Color): Square[] {
  const squares: Square[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (piece && piece.color === color && getPieceDefinition(piece.type).royal) {
      squares.push(square);
    }
  }
  return squares;
}

/** True if any royal piece of `color` is attacked in this position. */
export function isRoyalAttacked(state: GameState, color: Color): boolean {
  const enemy = opposite(color);
  return royalSquares(state.board, color).some((square) => isSquareAttackedBy(state, square, enemy));
}

/** True if `color` is currently in check. */
export function isInCheck(state: GameState, color = state.turn): boolean {
  return isRoyalAttacked(state, color);
}

/** True if playing `move` would leave the mover's own king attacked — or dead. */
export function leavesKingExposed(state: GameState, move: Move): boolean {
  const board = applyMoveToBoard(state.board, move);
  // Throwing your own king away (e.g. attacking a Champion with it) is illegal.
  if (royalSquares(board, move.color).length < royalSquares(state.board, move.color).length) {
    return true;
  }
  return isRoyalAttacked({ ...state, board }, move.color);
}

/** Every legal move for a colour (defaults to the side to move). */
export function generateLegalMoves(state: GameState, color = state.turn): Move[] {
  // Per-square so that per-piece legal-move restrictions (Warhound) apply.
  const moves: Move[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (!piece || piece.color !== color) continue;
    moves.push(...generateLegalMovesFrom(state, square));
  }
  return moves;
}

/** Legal moves for the piece standing on `from`. */
export function generateLegalMovesFrom(state: GameState, from: Square): Move[] {
  const legal = generatePseudoLegalMovesFrom(state, from).filter(
    (move) => !leavesKingExposed(state, move),
  );

  // Rules that depend on which moves are actually legal — e.g. the Warhound
  // must capture when a legal capture exists, but a pinned "capture" that
  // would expose the king never forces it.
  const piece = state.board[from];
  if (piece) {
    const definition = getPieceDefinition(piece.type);
    if (definition.restrictLegalMoves) {
      return definition.restrictLegalMoves(legal, { state, square: from, piece });
    }
  }
  return legal;
}

/**
 * Every legal move between two squares. Usually one, but abilities create
 * genuine choices on the same squares (promotion piece, sacrifice-and-swap,
 * return a reserve pawn) that the player has to pick between.
 */
export function legalMovesBetween(state: GameState, from: Square, to: Square): Move[] {
  return generateLegalMovesFrom(state, from).filter((move) => move.to === to);
}

/** Finds the legal move matching from/to (and promotion, if given). */
export function findLegalMove(
  state: GameState,
  from: Square,
  to: Square,
  promotion?: PieceType,
): Move | null {
  const candidates = legalMovesBetween(state, from, to);
  if (candidates.length === 0) return null;
  if (promotion) return candidates.find((move) => move.promotion === promotion) ?? null;
  return candidates[0] ?? null;
}

/** True if this player has at least one free move available (Duelist). */
export function hasBonusMoves(state: GameState, color = state.turn): boolean {
  if (!state.hasAbilityPieces) return false;
  const probe: GameState = { ...state, turn: color, phase: 'bonus' };
  return generateLegalMoves(probe, color).length > 0;
}
