/**
 * Game state transitions.
 *
 * `GameState` is immutable: every function here returns a brand-new state.
 * That makes games trivially serializable, replayable and undoable later, and
 * keeps React rendering honest.
 *
 * A turn is normally one move. Pieces with an extra-move ability (Duelist)
 * hand their owner an optional free move first: the state stays on the same
 * player with `phase: 'bonus'` until they use or skip it.
 */

import { applyMoveToBoard, createPiece } from './apply';
import {
  BOARD_SIZE,
  FILE_COUNT,
  RANK_COUNT,
  emptyBoard,
  fileOf,
  makeSquare,
  promotionRank,
  rankOf,
  straightPath,
} from './board';

export { straightPath };
import { boardHasAbilityPieces } from './auras';
import { beginTurn, hasEffect, pruneEffects } from './effects';
import { tickPlies } from './boardEffects';
import { interceptTripwire, processTraps } from './traps';
import {
  ALL_CASTLING_RULES,
  CASTLING_RULES,
  FULL_CASTLING_RIGHTS,
  NO_CASTLING_RIGHTS,
} from './castling';
import { START_FEN, parseFen, positionKey, toFen } from './fen';
import {
  findLegalMove,
  generateLegalMoves,
  hasBonusMoves,
  isInCheck,
  isRoyalAttacked,
  royalSquares,
} from './moveGeneration';
import { toSan } from './notation';
import { STANDARD_BACK_RANK, getPieceDefinition } from './pieces';
import type {
  Board,
  CastlingRights,
  Color,
  GameState,
  GameStatus,
  Move,
  PieceType,
  Square,
  TurnPhase,
} from './types';
import { opposite } from './types';

/** Standard starting position, as data. Alternate rosters swap this out later. */
export function createStandardBoard(): Board {
  const board = emptyBoard().slice();
  for (let file = 0; file < FILE_COUNT; file++) {
    const type = STANDARD_BACK_RANK[file] as PieceType;
    const whiteBack = makeSquare(file, 0);
    const blackBack = makeSquare(file, RANK_COUNT - 1);
    const whitePawn = makeSquare(file, 1);
    const blackPawn = makeSquare(file, RANK_COUNT - 2);
    board[whiteBack] = createPiece('white', type, whiteBack);
    board[blackBack] = createPiece('black', type, blackBack);
    board[whitePawn] = createPiece('white', 'pawn', whitePawn);
    board[blackPawn] = createPiece('black', 'pawn', blackPawn);
  }
  return board;
}

interface BaseStateInput {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  enPassant: Square | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

/** Unique piece types a colour fields on a board — what a Spy may become. */
function collectRosterTypes(board: Board, color: Color): PieceType[] {
  const types = new Set<PieceType>();
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (piece && piece.color === color) types.add(piece.origin ?? piece.type);
  }
  return [...types];
}

/** The card every player starts with, one of each. See spells.ts. */
export const STARTER_SPELLS: readonly string[] = [
  'shield',
  'reveal',
  'freeze',
  'teleport',
  'sacrifice',
  'smoke-screen',
  'reconnaissance',
  'royal-order',
  'last-stand',
  'interference',
  'null-field',
  'sacred-ground',
  'mirror-shield',
  'crown-of-command',
  'wall',
  'portal',
  'decay',
  'transform',
  'tripwire',
  'sonar',
  'web-trap',
  'dead-zone',
  'mine',
];

const freshBook = (cards: readonly string[]) => ({
  available: [...cards],
  used: [],
  revealed: false,
});

interface NewGameOptions {
  /** Spell cards on or off. The plain starting position turns them off. */
  readonly withSpells?: boolean;
  /**
   * Per-colour card decks (an army's chosen 5 spells + 5 traps). Omitted =
   * the full card set (used by FEN games and tests).
   */
  readonly spellBooks?: { readonly white: readonly string[]; readonly black: readonly string[] };
}

function finalizeNewGame(base: BaseStateInput, options: NewGameOptions = {}): GameState {
  const withSpells = options.withSpells ?? true;
  const bookFor = (color: Color): ReturnType<typeof freshBook> => {
    if (!withSpells) return freshBook([]);
    return freshBook(options.spellBooks ? options.spellBooks[color] : STARTER_SPELLS);
  };
  const draft: GameState = {
    ...base,
    phase: 'main',
    ambush: null,
    spells: { white: bookFor('white'), black: bookFor('black') },
    effects: [],
    traps: [],
    regions: [],
    squareStatuses: [],
    portals: [],
    pawnOrder: null,
    rosterTypes: {
      white: collectRosterTypes(base.board, 'white'),
      black: collectRosterTypes(base.board, 'black'),
    },
    history: [],
    captured: { white: [], black: [] },
    reserves: { white: [], black: [] },
    hasAbilityPieces: boardHasAbilityPieces(base.board),
    status: 'active',
    winner: null,
    positionCounts: {},
  };
  const status = computeStatus(draft, 1);
  return {
    ...draft,
    status,
    winner: status === 'checkmate' ? opposite(draft.turn) : null,
    positionCounts: { [positionKey(draft)]: 1 },
  };
}

export function createInitialState(): GameState {
  return finalizeNewGame(
    {
      board: createStandardBoard(),
      turn: 'white',
      castling: FULL_CASTLING_RIGHTS,
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
    },
    { withSpells: false },
  );
}

/** Build a game from a FEN string — the entry point for tests and saved games. */
export function createStateFromFen(fen: string = START_FEN): GameState {
  return finalizeNewGame(parseFen(fen));
}

/**
 * Castling rights a freshly deployed board is entitled to: a side may castle
 * on a wing when its King stands on the castling square and SOME friendly
 * piece holds the corner. A drafted army picks its own deployment, so the
 * corner is not reserved for a Rook — whoever stands there is the partner
 * (see `generateCastlingMoves`).
 */
export function castlingRightsFromBoard(board: Board): CastlingRights {
  let rights = NO_CASTLING_RIGHTS;
  for (const color of ['white', 'black'] as const) {
    for (const rule of CASTLING_RULES[color]) {
      const king = board[rule.kingFrom];
      const partner = board[rule.rookFrom];
      const ready =
        king !== null &&
        king !== undefined &&
        king.color === color &&
        getPieceDefinition(king.type).royal &&
        partner !== null &&
        partner !== undefined &&
        partner.color === color;
      if (ready) rights = { ...rights, [rule.rightsKey]: true };
    }
  }
  return rights;
}

/**
 * Build a game from an arbitrary board — how custom rosters start a match.
 * Castling rights are read off the deployment unless the caller names them.
 */
export function createStateFromBoard(
  board: Board,
  options: {
    turn?: Color;
    castling?: CastlingRights;
    spellBooks?: NewGameOptions['spellBooks'];
  } = {},
): GameState {
  return finalizeNewGame(
    {
      board,
      turn: options.turn ?? 'white',
      castling: options.castling ?? castlingRightsFromBoard(board),
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
    },
    options.spellBooks ? { spellBooks: options.spellBooks } : {},
  );
}

/** Castling rights lost by a move (king/rook leaving home, or rook captured). */
function updateCastlingRights(rights: CastlingRights, move: Move): CastlingRights {
  let next = rights;
  for (const rule of ALL_CASTLING_RULES) {
    if (!next[rule.rightsKey]) continue;
    const touched =
      move.from === rule.kingFrom ||
      move.from === rule.rookFrom ||
      move.to === rule.rookFrom ||
      // A royal swap moves the king even though `from` is the Double's square.
      (move.special === 'royal-swap' && move.to === rule.kingFrom);
    if (touched) next = { ...next, [rule.rightsKey]: false };
  }
  return next;
}

/** True if `color` has a piece able to react to passers (an Ambusher). */
function hasAmbusher(board: Board, color: Color): boolean {
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (!piece || piece.color !== color) continue;
    const abilities = getPieceDefinition(piece.type).abilities;
    if (abilities?.some((ability) => ability.kind === 'ambush-passers')) return true;
  }
  return false;
}

const swapCastlingRights = (rights: CastlingRights): CastlingRights => ({
  whiteKingside: rights.blackKingside,
  whiteQueenside: rights.blackQueenside,
  blackKingside: rights.whiteKingside,
  blackQueenside: rights.whiteQueenside,
});

/**
 * The square behind a double-pushed pawn — but only when an enemy pawn is
 * actually placed to capture there. Recording it unconditionally would make
 * two otherwise identical positions compare as different for repetition.
 */
function enPassantSquareAfter(state: GameState, board: Board, move: Move): Square | null {
  const skipped = makeSquare(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2);
  const rank = rankOf(move.to);
  const file = fileOf(move.to);
  const pushed = board[move.to];
  if (!pushed) return null;

  for (const neighbourFile of [file - 1, file + 1]) {
    if (neighbourFile < 0 || neighbourFile >= FILE_COUNT) continue;
    const from = makeSquare(neighbourFile, rank);
    const neighbour = board[from];
    if (!neighbour || neighbour.color === move.color || neighbour.type !== move.piece) continue;

    const capture: Move = {
      from,
      to: skipped,
      piece: neighbour.type,
      color: neighbour.color,
      special: 'en-passant',
      captured: { type: pushed.type, color: pushed.color, id: pushed.id, square: move.to },
    };
    const probe: GameState = { ...state, board: applyMoveToBoard(board, capture) };
    if (!isRoyalAttacked(probe, neighbour.color)) return skipped;
  }
  return null;
}

const withoutOne = (list: readonly PieceType[], type: PieceType): PieceType[] => {
  const index = list.indexOf(type);
  if (index < 0) return [...list];
  return [...list.slice(0, index), ...list.slice(index + 1)];
};

/**
 * Minimal position transition: board, turn, clocks and the piece pools.
 * Ends the turn — the optional bonus phase is layered on in `applyMove`.
 */
export function advance(state: GameState, move: Move): GameState {
  const board = applyMoveToBoard(state.board, move);
  const defecting = move.special === 'defect';

  let captured = state.captured;
  let reserves = state.reserves;

  /**
   * A removed piece always joins its owner's reserves; it only counts as an
   * opponent capture when it belonged to the enemy. A Berserker or Ram
   * destroying its own piece is a loss, not a capture for anyone.
   */
  const recordRemoval = (type: PieceType, owner: Color) => {
    if (owner !== move.color) {
      captured = { ...captured, [move.color]: [...captured[move.color], type] };
    }
    reserves = { ...reserves, [owner]: [...reserves[owner], type] };
  };

  if (move.repelled) {
    // The attacker died on the defender's armour: it becomes the defender's
    // kill — unless the defender was a friendly piece (a Berserker throwing
    // itself at its own Champion), which credits nobody.
    const defender = state.board[move.to];
    if (defender && defender.color !== move.color) {
      captured = {
        ...captured,
        [defender.color]: [...captured[defender.color], move.piece],
      };
    }
    reserves = { ...reserves, [move.color]: [...reserves[move.color], move.piece] };
  } else if (move.captured) {
    recordRemoval(move.captured.type, move.captured.color);
  }

  for (const extra of move.extraCaptures ?? []) {
    recordRemoval(extra.type, extra.color);
  }

  if (move.returns) {
    reserves = { ...reserves, [move.color]: withoutOne(reserves[move.color], move.returns.type) };
  }

  let rosterTypes = state.rosterTypes;
  let spells = state.spells;
  if (defecting) {
    // Both armies change hands, and so do their pools of fallen pieces.
    captured = { white: captured.black, black: captured.white };
    reserves = { white: reserves.black, black: reserves.white };
    rosterTypes = { white: rosterTypes.black, black: rosterTypes.white };
    spells = { white: spells.black, black: spells.white };
  }

  const enPassant = defecting
    ? null
    : move.special === 'double-push'
      ? enPassantSquareAfter(state, board, move)
      : // A free move mid-turn must not wipe out an en passant chance created
        // by the same turn's main move.
        move.bonus
        ? state.enPassant
        : null;

  const resetsClock =
    move.piece === 'pawn' ||
    Boolean(move.captured) ||
    Boolean(move.extraCaptures?.length) ||
    move.repelled ||
    defecting;

  // Open a one-turn ambush window when this move crossed squares an enemy
  // Ambusher could be guarding. Only recorded when such a piece exists so
  // repetition detection stays exact for everyone else.
  let ambush: GameState['ambush'] = null;
  if (!defecting && !move.repelled && !move.teleport && move.special !== 'transform') {
    const path = straightPath(move.from, move.to);
    if (path.length > 0 && hasAmbusher(board, opposite(move.color))) {
      ambush = { path, victim: move.to };
    }
  }

  // The opponent's turn begins here: effects age, and a Decay curse whose
  // victim belongs to them may crumble that piece before they play.
  const started = beginTurn(board, state.effects, opposite(state.turn), 'main');
  for (const lost of started.decayed) {
    reserves = { ...reserves, [lost.color]: [...reserves[lost.color], lost.type] };
  }

  return {
    ...state,
    board: started.board,
    turn: opposite(state.turn),
    phase: 'main',
    ambush,
    castling: defecting
      ? swapCastlingRights(updateCastlingRights(state.castling, move))
      : updateCastlingRights(state.castling, move),
    enPassant,
    halfmoveClock: resetsClock ? 0 : state.halfmoveClock + 1,
    fullmoveNumber: state.turn === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber,
    captured,
    reserves,
    rosterTypes,
    spells,
    effects: started.effects,
    regions: tickPlies(state.regions),
    squareStatuses: tickPlies(state.squareStatuses),
    pawnOrder: null,
    hasAbilityPieces: state.hasAbilityPieces && boardHasAbilityPieces(started.board),
  };
}

/**
 * True if `color` has a piece whose ability wins on the far back rank (an
 * Assassin) standing there right now.
 */
export function hasBackRankVictory(board: Board, color: Color): boolean {
  const backRank = promotionRank(color);
  for (let file = 0; file < FILE_COUNT; file++) {
    const piece = board[makeSquare(file, backRank)];
    if (!piece || piece.color !== color) continue;
    const abilities = getPieceDefinition(piece.type).abilities;
    if (abilities?.some((ability) => ability.kind === 'win-on-back-rank')) return true;
  }
  return false;
}

/**
 * K vs K, K+minor vs K, and K+B vs K+B on the same colour complex.
 * Conservative: any unrecognised (custom) piece means "material is sufficient".
 */
export function hasInsufficientMaterial(board: Board): boolean {
  const minors: { color: Color; type: PieceType; squareColor: number }[] = [];

  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (!piece) continue;
    if (getPieceDefinition(piece.type).royal) continue;
    if (piece.type === 'bishop' || piece.type === 'knight') {
      minors.push({
        color: piece.color,
        type: piece.type,
        squareColor: (fileOf(square) + rankOf(square)) % 2,
      });
      continue;
    }
    return false; // pawn, rook, queen or a custom piece — mate remains possible
  }

  if (minors.length <= 1) return true;
  if (minors.length === 2) {
    const [first, second] = minors as [(typeof minors)[number], (typeof minors)[number]];
    return (
      first.type === 'bishop' &&
      second.type === 'bishop' &&
      first.color !== second.color &&
      first.squareColor === second.squareColor
    );
  }
  return false;
}

/** Status of the position for the side to move. */
function computeStatus(state: GameState, repetitionCount: number): GameStatus {
  // A side with no royal piece has already lost, whatever the rest of the
  // position says. Ordinary chess can never reach this; a card can.
  if (royalSquares(state.board, 'white').length === 0) return 'annihilation';
  if (royalSquares(state.board, 'black').length === 0) return 'annihilation';

  const check = isInCheck(state);
  const hasMoves = generateLegalMoves(state).length > 0;

  if (!hasMoves) return check ? 'checkmate' : 'stalemate';
  if (state.halfmoveClock >= 100) return 'draw-fifty-move';
  if (repetitionCount >= 3) return 'draw-threefold-repetition';
  if (hasInsufficientMaterial(state.board)) return 'draw-insufficient-material';
  return check ? 'check' : 'active';
}

const isTerminal = (status: GameStatus): boolean => status !== 'active' && status !== 'check';

/** Finishes a transition: records the result, status, history and repetition. */
export function settle(
  previous: GameState,
  next: GameState,
  entry: { move?: Move; cast?: GameState['history'][number]['cast']; san: string; fenBefore: string } | null,
): GameState {
  const key = positionKey(next);
  const repetitionCount = (previous.positionCounts[key] ?? 0) + 1;
  const status = computeStatus(next, repetitionCount);

  return {
    ...next,
    history: entry ? [...previous.history, entry] : previous.history,
    status,
    winner: winnerFor(next, status),
    positionCounts: { ...previous.positionCounts, [key]: repetitionCount },
  };
}

/** Who won, for the statuses that have a winner at all. */
function winnerFor(state: GameState, status: GameStatus): Color | null {
  if (status === 'checkmate') return opposite(state.turn);
  if (status === 'annihilation') {
    // Whoever still has a King standing. If nobody does, nobody won.
    if (royalSquares(state.board, 'white').length > 0) return 'white';
    if (royalSquares(state.board, 'black').length > 0) return 'black';
  }
  return null;
}

/**
 * Plays a move that is already known to be legal, returning the next state
 * with history, pools, phase and status all updated.
 */
export function applyMove(state: GameState, chosen: Move): GameState {
  const fenBefore = toFen(state);
  const legalBefore = generateLegalMoves(state);

  // Tripwire may cut the movement short before it resolves.
  const interception = interceptTripwire(state, chosen);
  const move = interception.move;
  const working: GameState =
    interception.traps === state.traps ? state : { ...state, traps: interception.traps };

  let passed = advance(working, move);

  // Landing triggers (Web Trap, Sonar, Mine, Dead Zone) and pending-zone
  // activation.
  if (passed.traps.length > 0) {
    const moverSquare = move.special === 'defect' ? null : move.repelled ? null : move.to;
    const moverImmune =
      state.squareStatuses.some(
        (status) => status.kind === 'sacred-ground' && status.square === move.to,
      ) && passed.board[move.to] !== null;
    const landing = processTraps(passed, moverSquare, moverImmune);
    passed = {
      ...passed,
      traps: landing.traps,
      squareStatuses: landing.squareStatuses,
      effects: landing.webbedPieceId
        ? [
            ...passed.effects,
            {
              id: `webbed:${landing.webbedPieceId}:${state.fullmoveNumber}`,
              kind: 'webbed' as const,
              caster: opposite(move.color),
              targetPieceId: landing.webbedPieceId,
              expiresAtTurnStartOf: opposite(move.color),
            },
          ]
        : passed.effects,
    };

    // Mine detonation: destroy the arriving piece — unless removing it would
    // leave its own king in check, in which case the blast fizzles (the
    // mine is spent either way). Destruction is not a capture: nothing is
    // credited, but the piece joins its owner's reserves.
    if (landing.destroyedSquare !== null) {
      const victim = passed.board[landing.destroyedSquare];
      if (victim) {
        const blasted = passed.board.slice();
        blasted[landing.destroyedSquare] = null;
        const probe: GameState = { ...passed, board: blasted };
        if (!isRoyalAttacked(probe, victim.color)) {
          passed = {
            ...passed,
            board: blasted,
            reserves: {
              ...passed.reserves,
              [victim.color]: [...passed.reserves[victim.color], victim.type],
            },
            effects: pruneEffects(passed.effects, blasted),
          };
        }
      }
    }
  }

  // Alternative win condition: an Assassin standing on the opponent's back
  // row ends the game at once — before checks, bonus phases or draws.
  if (hasBackRankVictory(passed.board, move.color)) {
    const san = toSan(move, legalBefore, { check: false, checkmate: false });
    const key = positionKey(passed);
    return {
      ...passed,
      history: [...state.history, { move, san, fenBefore }],
      status: 'assassin-victory',
      winner: move.color,
      positionCounts: { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 },
    };
  }

  const passedKey = positionKey(passed);
  const passedStatus = computeStatus(passed, (state.positionCounts[passedKey] ?? 0) + 1);
  const check = passedStatus === 'check' || passedStatus === 'checkmate';
  const sanBase = toSan(move, legalBefore, { check, checkmate: passedStatus === 'checkmate' });
  const san = interception.tripped ? `${sanBase}†` : sanBase;
  const entry = { move, san, fenBefore };

  // The mover keeps the turn if a bonus window opens: a Royal Order pawn
  // move takes precedence, then a Duelist's free move. A tripped piece
  // forfeits every bonus for the turn.
  if (!move.bonus && !isTerminal(passedStatus) && !interception.tripped) {
    // A Crown of Command spends itself the first time its wearer moves,
    // buying the same bonus Pawn move a Royal Order does.
    const wearer = state.board[move.from] ?? null;
    const crowned = wearer !== null && hasEffect(state.effects, 'crown', wearer.id);
    const orderArmed =
      crowned || (state.pawnOrder?.stage === 'armed' && state.pawnOrder.color === state.turn);
    const orderProbe: GameState = {
      ...passed,
      turn: state.turn,
      phase: 'bonus',
      pawnOrder: { color: state.turn, stage: 'active' },
    };
    if (orderArmed && generateLegalMoves(orderProbe, state.turn).length > 0) {
      const wearerId = wearer?.id;
      const kept = crowned
        ? state.effects.filter(
            (effect) => !(effect.kind === 'crown' && effect.targetPieceId === wearerId),
          )
        : state.effects;
      const bonusState: GameState = {
        ...orderProbe,
        fullmoveNumber: state.fullmoveNumber,
        effects: pruneEffects(kept, passed.board),
        regions: state.regions,
        squareStatuses: passed.squareStatuses,
      };
      return settle(state, bonusState, entry);
    }

    if (hasBonusMoves(passed, state.turn)) {
      const bonusState: GameState = {
        ...passed,
        turn: state.turn,
        phase: 'bonus',
        fullmoveNumber: state.fullmoveNumber,
        // The opponent's turn has not actually begun: undo any premature
        // expiry — only prune effects whose target left the board.
        effects: pruneEffects(state.effects, passed.board),
        regions: state.regions,
        squareStatuses: passed.squareStatuses,
      };
      return settle(state, bonusState, entry);
    }
  }

  return settle(state, passed, entry);
}

/** Declines the free move and passes the turn. */
export function skipBonusMove(state: GameState): GameState {
  if (state.phase !== 'bonus') return state;
  const started = beginTurn(state.board, state.effects, opposite(state.turn), 'main');
  let reserves = state.reserves;
  for (const lost of started.decayed) {
    reserves = { ...reserves, [lost.color]: [...reserves[lost.color], lost.type] };
  }
  const passed: GameState = {
    ...state,
    board: started.board,
    turn: opposite(state.turn),
    phase: 'main' as TurnPhase,
    fullmoveNumber: state.turn === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber,
    effects: started.effects,
    reserves,
    regions: tickPlies(state.regions),
    squareStatuses: tickPlies(state.squareStatuses),
    pawnOrder: null,
  };
  return settle(state, passed, null);
}

/**
 * Validates and plays a move by coordinates. Returns null when the move is
 * illegal — the UI's single entry point for "the player tried to do this".
 */
export function playMove(
  state: GameState,
  from: Square,
  to: Square,
  promotion?: PieceType,
): GameState | null {
  if (isGameOver(state)) return null;
  const move = findLegalMove(state, from, to, promotion);
  return move ? applyMove(state, move) : null;
}

export function isGameOver(state: GameState): boolean {
  return isTerminal(state.status);
}

export function isDraw(state: GameState): boolean {
  return state.status === 'stalemate' || state.status.startsWith('draw-');
}

/** Rebuilds a game by replaying move objects from the start. */
export function replayMoves(moves: readonly Move[], fen: string = START_FEN): GameState {
  let state = createStateFromFen(fen);
  for (const move of moves) state = applyMove(state, move);
  return state;
}
