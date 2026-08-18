/**
 * Core domain types for the chess engine.
 *
 * Everything here is plain, serializable data — no classes, no behaviour.
 * Rules live in functions that take state and return new state, which keeps
 * the engine deterministic and easy to save / replay / send over a wire later.
 */

export type Color = 'white' | 'black';

/**
 * Standard piece identifiers. The `(string & {})` member intentionally keeps
 * this open: Chess 2 custom pieces register their own ids in the piece registry
 * without touching this union, while standard ids still autocomplete.
 */
export type PieceType =
  | 'king'
  | 'queen'
  | 'rook'
  | 'bishop'
  | 'knight'
  | 'pawn'
  | (string & {});

/** A board square, indexed 0..63 with 0 = a1 and 63 = h8. */
export type Square = number;

export interface Piece {
  readonly type: PieceType;
  readonly color: Color;
  /**
   * Stable identity for a physical piece, used by the UI for keys/animation.
   * Generated deterministically (never randomly) so state stays reproducible.
   */
  readonly id: string;
  /**
   * Remaining durability, for pieces with a hit-point ability (Champion).
   * Absent means the piece is captured by the first successful attack.
   */
  readonly hitPoints?: number;
  /**
   * The type this unit was originally drafted as, set when a piece changes
   * type mid-game (Jester transformation, pawn promotion). Abilities that
   * follow the unit rather than the shape (the Jester's) key off this.
   */
  readonly origin?: PieceType;
}

/** Immutable 64-entry board. `null` = empty square. */
export type Board = readonly (Piece | null)[];

export type SpecialMove =
  | 'double-push'
  | 'en-passant'
  | 'castle-kingside'
  | 'castle-queenside'
  /** Revolutionary: sacrifice itself and trade armies with the opponent. */
  | 'defect'
  /** Double: exchange squares with the friendly King. */
  | 'royal-swap'
  /** Spy: convert in place into another piece from the owner's roster. */
  | 'transform'
  /** Ambusher: capture a piece that just passed through its guard zone. */
  | 'ambush';

/**
 * A turn is normally one move. Pieces with an extra-move ability (Duelist)
 * give their owner an optional second, "bonus" move before the turn passes.
 */
export type TurnPhase = 'main' | 'bonus';

export interface CapturedInfo {
  readonly type: PieceType;
  readonly color: Color;
  readonly id: string;
  /** The square the captured piece stood on (differs from `to` for en passant). */
  readonly square: Square;
}

/**
 * A fully-described move. Self-contained so it can be logged, replayed or
 * transmitted without needing the position it came from.
 */
export interface Move {
  readonly from: Square;
  readonly to: Square;
  readonly piece: PieceType;
  readonly color: Color;
  readonly captured?: CapturedInfo;
  /** Piece type a pawn promotes to. */
  readonly promotion?: PieceType;
  readonly special?: SpecialMove;
  /** Rook relocation for castling moves. */
  readonly rook?: { readonly from: Square; readonly to: Square };

  // --- Chess 2 ability effects -------------------------------------------
  /**
   * Additional pieces removed by this move beyond `captured` — e.g. the
   * Battering Ram crushing the square it passes through. May include friendly
   * pieces; a friendly removal never counts as an opponent capture.
   */
  readonly extraCaptures?: readonly CapturedInfo[];
  /** Squares whose occupants change allegiance (Diplomat). */
  readonly converts?: readonly Square[];
  /**
   * The target survived on hit points and destroyed the attacker instead
   * (Champion). The moving piece is removed; the target stays put.
   */
  readonly repelled?: boolean;
  /** A piece brought back from the reserves onto the board (Chariot). */
  readonly returns?: { readonly square: Square; readonly type: PieceType };
  /** Played as a free extra move rather than the turn's main move (Duelist). */
  readonly bonus?: boolean;
  /**
   * The piece translocates without traversing the squares in between
   * (Squire's jump, royal swap, ambush reaction) — it can never be ambushed
   * for "passing through" anything.
   */
  readonly teleport?: boolean;
}

export interface CastlingRights {
  readonly whiteKingside: boolean;
  readonly whiteQueenside: boolean;
  readonly blackKingside: boolean;
  readonly blackQueenside: boolean;
}

export type GameStatus =
  | 'active'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  /** An Assassin reached the opponent's back row — instant win. */
  | 'assassin-victory'
  | 'draw-fifty-move'
  | 'draw-insufficient-material'
  | 'draw-threefold-repetition';

/**
 * A one-turn capture window (like en passant, generalised): the previous move
 * passed through `path`, and the mover now stands on `victim`. An enemy
 * Ambusher whose guard zone covers a path square may capture the mover there.
 */
export interface AmbushWindow {
  readonly path: readonly Square[];
  readonly victim: Square;
}

/** A spell being played: which card, by whom, at which square(s). */
export interface SpellCast {
  readonly spell: string;
  readonly color: Color;
  /** Targets in selection order (piece, then destination/second piece). */
  readonly targets: readonly Square[];
}

export interface HistoryEntry {
  /** The chess move played — absent when the turn was spent on a spell. */
  readonly move?: Move;
  /** The spell cast — absent for ordinary chess moves. */
  readonly cast?: SpellCast;
  /** Standard Algebraic Notation, e.g. "Nxe5+", or a spell descriptor. */
  readonly san: string;
  /** Position (FEN) *before* the action — enough to replay from any point. */
  readonly fenBefore: string;
}

/**
 * One player's spell cards. `available`/`used` track the one-shot lifecycle;
 * `revealed` means this book is public knowledge (the opponent played
 * Reveal). The UI must only show an opponent's book when it is revealed —
 * `visibleOpponentSpells` is the sanctioned accessor.
 */
export interface SpellBook {
  readonly available: readonly string[];
  readonly used: readonly string[];
  readonly revealed: boolean;
}

/**
 * The complete, serializable game state. `JSON.parse(JSON.stringify(state))`
 * round-trips losslessly, which is what future save/replay/multiplayer need.
 */
export interface GameState {
  readonly board: Board;
  readonly turn: Color;
  /** Which part of the current player's turn is being played. */
  readonly phase: TurnPhase;
  readonly castling: CastlingRights;
  /** Square a pawn may be captured on by en passant, or null. */
  readonly enPassant: Square | null;
  /** Open ambush window from the previous move, or null. See {@link AmbushWindow}. */
  readonly ambush: AmbushWindow | null;
  /**
   * Piece types each side brought to the game — what a Spy may convert into.
   * Derived from the starting board, so it needs no roster object at runtime.
   */
  readonly rosterTypes: { readonly white: readonly PieceType[]; readonly black: readonly PieceType[] };
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly history: readonly HistoryEntry[];
  /** Pieces each colour has captured — i.e. `captured.white` are black pieces. */
  readonly captured: { readonly white: readonly PieceType[]; readonly black: readonly PieceType[] };
  /**
   * Pieces of each colour that were lost and are available to be returned to
   * the board by an ability (Chariot). Keyed by the *owner* of the piece.
   */
  readonly reserves: { readonly white: readonly PieceType[]; readonly black: readonly PieceType[] };
  /**
   * Cache: true while any piece with a passive/aura ability is on the board.
   * Purely an optimisation — it lets standard chess skip all ability work.
   */
  readonly hasAbilityPieces: boolean;
  /** Each player's one-shot spell cards. Empty books = spells disabled. */
  readonly spells: { readonly white: SpellBook; readonly black: SpellBook };
  /** Timed statuses currently attached to pieces (Shield, Freeze, Webbed). */
  readonly effects: readonly import('./effects').ActiveEffect[];
  /** Hidden one-shot board traps (Tripwire, Sonar, Web Trap, Dead Zone). */
  readonly traps: readonly import('./boardEffects').TrapPlacement[];
  /** Area effects (Smoke Screen, Null Field). */
  readonly regions: readonly import('./boardEffects').RegionEffect[];
  /** Per-square statuses (Sacred Ground, active Dead Zone terrain). */
  readonly squareStatuses: readonly import('./boardEffects').SquareStatus[];
  /**
   * Royal Order in flight: armed after the cast (the caster still moves
   * normally), active while the bonus pawn move is being taken.
   */
  readonly pawnOrder: { readonly color: Color; readonly stage: 'armed' | 'active' } | null;
  readonly status: GameStatus;
  /** Set when the game ended decisively; null for draws and ongoing games. */
  readonly winner: Color | null;
  /** Repetition counter keyed by position (FEN without the clocks). */
  readonly positionCounts: Readonly<Record<string, number>>;
}

export const opposite = (color: Color): Color => (color === 'white' ? 'black' : 'white');
