/**
 * Spell cards — one-shot tactical actions cast instead of a chess move.
 *
 * Spells are data in a registry, exactly like pieces: a definition describes
 * targeting, legality and resolution; `castSpell` is the single entry point
 * that validates a cast, applies it, and passes the turn. Adding a card means
 * registering a definition — the turn system, UI targeting flow, history and
 * persistence pick it up automatically.
 *
 * Enforcement of ongoing effects does NOT live here: a resolved Shield or
 * Freeze is an `ActiveEffect`, applied by the engine's existing funnels
 * (captureRules / isImmobilized). This module only creates them.
 */

import { BOARD_SIZE, fileOf, rankOf, squareName } from './board';
import {
  blockedSquares,
  isCardImmuneAt,
  nullFieldSquares,
  regionSquares,
  tickPlies,
  trapAt,
} from './boardEffects';
import { processTraps } from './traps';
import type { RegionEffect, SquareStatus, TrapKind, TrapPlacement } from './boardEffects';
import { tickEffects } from './effects';
import type { ActiveEffect } from './effects';
import { isImmobilized } from './auras';
import { settle } from './game';
import { isRoyalAttacked } from './moveGeneration';
import { toFen } from './fen';
import { getPieceDefinition } from './pieces';
import { classOfPiece } from './captureRules';
import { surroundingSquares } from './knightPieces';
import type { Color, GameState, PieceType, SpellCast, Square } from './types';
import { opposite } from './types';

export type SpellTargeting =
  | 'none'
  | 'friendly-piece'
  | 'enemy-piece'
  | 'square'
  | 'friendly-piece-then-square'
  | 'friendly-piece-then-adjacent-enemy';

export interface SpellDefinition {
  readonly id: string;
  readonly name: string;
  /** Emoji used on the card and in compact UI. */
  readonly icon: string;
  readonly description: string;
  readonly targeting: SpellTargeting;
  /** Legal first targets (piece squares), for targeting UIs and validation. */
  readonly primaryTargets?: (state: GameState, caster: Color) => Square[];
  /** Legal second targets given the first choice. */
  readonly secondaryTargets?: (state: GameState, caster: Color, first: Square) => Square[];
  /**
   * Resolves the spell against a fully validated target list, returning the
   * changed parts of the state (board/effects/pools). Turn passing, history
   * and status are handled by `castSpell`.
   */
  readonly resolve: (state: GameState, caster: Color, targets: readonly Square[]) => Partial<GameState>;
  /** History label, e.g. "Shield→e4". */
  readonly describe: (targets: readonly Square[]) => string;
  /** Extra playability requirement beyond having the card (Last Stand…). */
  readonly castable?: (state: GameState, caster: Color) => boolean;
  /**
   * Trap cards place hidden board effects instead of resolving openly: their
   * history label conceals the card, and Null Field does not restrict them
   * (it suppresses spells, not traps).
   */
  readonly isTrap?: boolean;
  /** Which selection stages point at pieces (Sacred Ground immunity applies). */
  readonly pieceStages?: readonly (0 | 1)[];
  /**
   * Full card-face artwork (a public asset path). Cards without art fall
   * back to their icon-and-text presentation.
   */
  readonly artwork?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const registry = new Map<string, SpellDefinition>();

/**
 * The official card-face art set. Royal Order, Tripwire and Mine await
 * theirs. (The kit's manifest labelled the Shield card "royal_order" — the
 * artwork itself is titled Shield and carries Shield's rules text, so it is
 * mapped by content, not by filename.)
 */
const CARD_ARTWORK: Readonly<Record<string, string>> = {
  shield: '/card_art/shield.png',
  reveal: '/card_art/reveal.png',
  freeze: '/card_art/freeze.png',
  teleport: '/card_art/teleport.png',
  sacrifice: '/card_art/sacrifice.png',
  'smoke-screen': '/card_art/smoke-screen.png',
  reconnaissance: '/card_art/reconnaissance.png',
  'last-stand': '/card_art/last-stand.png',
  interference: '/card_art/interference.png',
  'null-field': '/card_art/null-field.png',
  'sacred-ground': '/card_art/sacred-ground.png',
  sonar: '/card_art/sonar.png',
  'web-trap': '/card_art/web-trap.png',
  'dead-zone': '/card_art/dead-zone.png',
};

export function registerSpell(definition: SpellDefinition): void {
  const artwork = definition.artwork ?? CARD_ARTWORK[definition.id];
  registry.set(definition.id, artwork ? { ...definition, artwork } : definition);
}

export function getSpellDefinition(id: string): SpellDefinition {
  const definition = registry.get(id);
  if (!definition) throw new Error(`Unknown spell: ${id}`);
  return definition;
}

export function allSpellDefinitions(): SpellDefinition[] {
  return [...registry.values()];
}

/** Sacrifice trades by point value; costs are data on the piece definitions. */
export function pieceValue(type: PieceType): number {
  const definition = getPieceDefinition(type);
  return definition.cost ?? definition.value;
}

const friendlyPieces = (state: GameState, caster: Color, includeRoyal: boolean): Square[] => {
  const squares: Square[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (!piece || piece.color !== caster) continue;
    if (!includeRoyal && getPieceDefinition(piece.type).royal) continue;
    squares.push(square);
  }
  return squares;
};

const enemyPieces = (state: GameState, caster: Color, includeRoyal: boolean): Square[] =>
  friendlyPieces(state, opposite(caster), includeRoyal);

/* ------------------------------------------------------------------ */
/* The five starter cards                                              */
/* ------------------------------------------------------------------ */

registerSpell({
  id: 'shield',
  name: 'Shield',
  icon: '🛡️',
  description:
    'Choose a friendly piece. It cannot be captured — by any means — until your next turn begins.',
  targeting: 'friendly-piece',
  pieceStages: [0],
  // Royals are excluded: a king already cannot be captured, and shielding
  // him must never blank out check.
  primaryTargets: (state, caster) => friendlyPieces(state, caster, false),
  resolve: (state, caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    const effect: ActiveEffect = {
      id: `shield:${piece.id}:${state.fullmoveNumber}`,
      kind: 'shield',
      caster,
      targetPieceId: piece.id,
      expiresAtTurnStartOf: caster,
    };
    return { effects: [...state.effects, effect] };
  },
  describe: (targets) => `Shield→${squareName(targets[0]!)}`,
});

registerSpell({
  id: 'reveal',
  name: 'Reveal',
  icon: '👁️',
  description:
    "See the opponent's remaining spell cards. The knowledge lasts for the rest of the game.",
  targeting: 'none',
  resolve: (state, caster) => {
    const enemy = opposite(caster);
    return {
      spells: {
        ...state.spells,
        [enemy]: { ...state.spells[enemy], revealed: true },
      },
    };
  },
  describe: () => 'Reveal',
});

registerSpell({
  id: 'freeze',
  name: 'Freeze',
  icon: '❄️',
  description:
    "Choose an enemy piece. It cannot move or act during the opponent's next turn.",
  targeting: 'enemy-piece',
  pieceStages: [0],
  // Royals are excluded: a frozen king stops attacking, which would let the
  // enemy king walk illegally close.
  primaryTargets: (state, caster) => enemyPieces(state, caster, false),
  resolve: (state, caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    const effect: ActiveEffect = {
      id: `freeze:${piece.id}:${state.fullmoveNumber}`,
      kind: 'freeze',
      caster,
      targetPieceId: piece.id,
      expiresAtTurnStartOf: caster,
    };
    return { effects: [...state.effects, effect] };
  },
  describe: (targets) => `Freeze→${squareName(targets[0]!)}`,
});

const sameSquareColor = (a: Square, b: Square): boolean =>
  (fileOf(a) + rankOf(a)) % 2 === (fileOf(b) + rankOf(b)) % 2;

registerSpell({
  id: 'teleport',
  name: 'Teleport',
  icon: '✨',
  description:
    'Move a friendly piece to any empty square of the same colour as the one it stands on.',
  targeting: 'friendly-piece-then-square',
  pieceStages: [0],
  // The king may teleport; frozen or trapped pieces may not act.
  primaryTargets: (state, caster) =>
    friendlyPieces(state, caster, true).filter((square) => !isImmobilized(state, square)),
  secondaryTargets: (state, _caster, first) => {
    const squares: Square[] = [];
    const blocked = blockedSquares(state);
    for (let square = 0; square < BOARD_SIZE; square++) {
      if (square === first || state.board[square] || blocked.has(square)) continue;
      if (sameSquareColor(square, first)) squares.push(square);
    }
    return squares;
  },
  resolve: (state, _caster, [from, to]) => {
    const board = state.board.slice();
    board[to!] = board[from!] ?? null;
    board[from!] = null;
    return { board };
  },
  describe: (targets) => `Teleport ${squareName(targets[0]!)}→${squareName(targets[1]!)}`,
});

registerSpell({
  id: 'sacrifice',
  name: 'Sacrifice',
  icon: '⚔️',
  description:
    'Destroy one of your pieces and one adjacent enemy piece of equal point value. Destruction is not a capture.',
  targeting: 'friendly-piece-then-adjacent-enemy',
  pieceStages: [0, 1],
  primaryTargets: (state, caster) =>
    friendlyPieces(state, caster, false).filter(
      (square) => sacrificeTargets(state, caster, square).length > 0,
    ),
  secondaryTargets: (state, caster, first) => sacrificeTargets(state, caster, first),
  resolve: (state, _caster, [own, enemy]) => {
    const ownPiece = state.board[own!];
    const enemyPiece = state.board[enemy!];
    const board = state.board.slice();
    board[own!] = null;
    board[enemy!] = null;

    // Destruction, not capture: nothing is credited to `captured` (so the
    // Avenger and Jailer see nothing) — but both pieces are lost, so they
    // join their owners' reserves like every other removal.
    let reserves = state.reserves;
    if (ownPiece) {
      reserves = { ...reserves, [ownPiece.color]: [...reserves[ownPiece.color], ownPiece.type] };
    }
    if (enemyPiece) {
      reserves = {
        ...reserves,
        [enemyPiece.color]: [...reserves[enemyPiece.color], enemyPiece.type],
      };
    }
    return { board, reserves };
  },
  describe: (targets) => `Sacrifice ${squareName(targets[0]!)}×${squareName(targets[1]!)}`,
});

/** Adjacent enemy pieces of equal value that are legal Sacrifice victims. */
function sacrificeTargets(state: GameState, caster: Color, own: Square): Square[] {
  const ownPiece = state.board[own];
  if (!ownPiece || ownPiece.color !== caster) return [];
  if (getPieceDefinition(ownPiece.type).royal) return [];
  const value = pieceValue(ownPiece.type);

  return surroundingSquares(own).filter((square) => {
    const enemy = state.board[square];
    if (!enemy || enemy.color === caster) return false;
    if (getPieceDefinition(enemy.type).royal) return false;
    // A Shield guards against hostile destruction too.
    if (state.effects.some((e) => e.kind === 'shield' && e.targetPieceId === enemy.id)) return false;
    return pieceValue(enemy.type) === value;
  });
}

/* ------------------------------------------------------------------ */
/* Batch 6 spells                                                      */
/* ------------------------------------------------------------------ */

const allSquares = (_state: GameState): Square[] => {
  const squares: Square[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) squares.push(square);
  return squares;
};

const pieceCount = (state: GameState, color: Color): number =>
  state.board.reduce((total, piece) => (piece?.color === color ? total + 1 : total), 0);

registerSpell({
  id: 'smoke-screen',
  name: 'Smoke Screen',
  icon: '🌫️',
  description:
    'Cover a 3×3 area in smoke for two full rounds. Your opponent cannot see the pieces inside; play continues normally.',
  targeting: 'square',
  primaryTargets: allSquares,
  resolve: (state, caster, [center]) => {
    const region: RegionEffect = {
      id: `smoke:${center}:${state.fullmoveNumber}:${caster[0]}`,
      kind: 'smoke',
      owner: caster,
      center: center!,
      squares: regionSquares(center!),
      pliesRemaining: 5, // active for the 4 plies after the cast boundary
    };
    return { regions: [...state.regions, region] };
  },
  describe: (targets) => `Smoke→${squareName(targets[0]!)}`,
});

/** Deterministic PRNG seed from the position — replays stay reproducible. */
function stateSeed(state: GameState): number {
  const text = toFen(state) + ':' + state.history.length;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The up-to-two cards Reconnaissance would expose, chosen deterministically. */
export function reconPicks(state: GameState, caster: Color): string[] {
  const pool = [...state.spells[opposite(caster)].available];
  if (pool.length <= 2) return pool;
  let seed = stateSeed(state);
  const picks: string[] = [];
  for (let n = 0; n < 2; n++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const index = seed % pool.length;
    picks.push(pool.splice(index, 1)[0]!);
  }
  return picks.sort();
}

registerSpell({
  id: 'reconnaissance',
  name: 'Recon',
  icon: '🔍',
  description:
    "Glimpse up to two random cards from the opponent's remaining hand. The cards stay hidden afterwards and are not removed.",
  targeting: 'none',
  castable: (state, caster) => state.spells[opposite(caster)].available.length > 0,
  resolve: () => ({}),
  describe: () => 'Recon',
});

registerSpell({
  id: 'royal-order',
  name: 'Royal Order',
  icon: '📯',
  description:
    'Command the ranks: after your normal move this turn, one of your Pawns may immediately make one extra legal move.',
  targeting: 'none',
  castable: (state, caster) =>
    state.pawnOrder === null &&
    state.board.some((piece) => piece?.color === caster && classOfPiece(piece.type) === 'pawn'),
  resolve: () => ({}),
  describe: () => 'Royal Order',
});

registerSpell({
  id: 'last-stand',
  name: 'Last Stand',
  icon: '🔰',
  description:
    'Outnumbered only: a friendly piece survives the next attempt to capture it (the attacker is lost in the attempt).',
  targeting: 'friendly-piece',
  pieceStages: [0],
  castable: (state, caster) => pieceCount(state, caster) < pieceCount(state, opposite(caster)),
  primaryTargets: (state, caster) => friendlyPieces(state, caster, false),
  resolve: (state, _caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    const board = state.board.slice();
    board[target!] = { ...piece, hitPoints: (piece.hitPoints ?? 1) + 1 };
    return { board };
  },
  describe: (targets) => `Last Stand→${squareName(targets[0]!)}`,
});

registerSpell({
  id: 'interference',
  name: 'Interference',
  icon: '⚡',
  description: 'Disable one revealed enemy trap. It never fires.',
  targeting: 'square',
  castable: (state, caster) =>
    state.traps.some((trap) => trap.owner !== caster && trap.revealed && trap.armed),
  primaryTargets: (state, caster) =>
    state.traps
      .filter((trap) => trap.owner !== caster && trap.revealed && trap.armed)
      .map((trap) => trap.square),
  resolve: (state, caster, [target]) => ({
    traps: state.traps.filter(
      (trap) => !(trap.square === target && trap.owner !== caster && trap.revealed && trap.armed),
    ),
  }),
  describe: (targets) => `Interference→${squareName(targets[0]!)}`,
});

registerSpell({
  id: 'null-field',
  name: 'Null Field',
  icon: '🌀',
  description:
    'Suppress magic in a 3×3 area until your next turn: no spell may target anything inside. Traps and normal chess are unaffected.',
  targeting: 'square',
  primaryTargets: allSquares,
  resolve: (state, caster, [center]) => {
    const region: RegionEffect = {
      id: `null:${center}:${state.fullmoveNumber}:${caster[0]}`,
      kind: 'null-field',
      owner: caster,
      center: center!,
      squares: regionSquares(center!),
      pliesRemaining: 2, // covers exactly the opponent's turn
    };
    return { regions: [...state.regions, region] };
  },
  describe: (targets) => `Null Field→${squareName(targets[0]!)}`,
});

registerSpell({
  id: 'sacred-ground',
  name: 'Sacred Ground',
  icon: '🌟',
  description:
    'Consecrate a square for one full round: whichever piece stands on it cannot be affected by cards. Chess itself is not suspended.',
  targeting: 'square',
  primaryTargets: allSquares,
  resolve: (state, caster, [target]) => {
    const status: SquareStatus = {
      id: `sacred:${target}:${state.fullmoveNumber}:${caster[0]}`,
      kind: 'sacred-ground',
      owner: caster,
      square: target!,
      pliesRemaining: 3, // both players get one turn under its protection
    };
    return { squareStatuses: [...state.squareStatuses, status] };
  },
  describe: (targets) => `Sacred Ground→${squareName(targets[0]!)}`,
});

/* ------------------------------------------------------------------ */
/* Trap cards — hidden placements                                      */
/* ------------------------------------------------------------------ */

function registerTrap(config: {
  id: TrapKind;
  name: string;
  icon: string;
  description: string;
}): void {
  registerSpell({
    id: config.id,
    name: config.name,
    icon: config.icon,
    description: config.description,
    targeting: 'square',
    isTrap: true,
    primaryTargets: (state) => {
      const blocked = blockedSquares(state);
      const squares: Square[] = [];
      for (let square = 0; square < BOARD_SIZE; square++) {
        if (state.board[square] || blocked.has(square)) continue;
        if (trapAt(state, square)) continue; // one trap per square
        squares.push(square);
      }
      return squares;
    },
    resolve: (state, caster, [target]) => {
      const placement: TrapPlacement = {
        id: `${config.id}:${target}:${state.fullmoveNumber}:${caster[0]}`,
        trap: config.id,
        owner: caster,
        square: target!,
        revealed: false,
        armed: true,
      };
      return { traps: [...state.traps, placement] };
    },
    // The history must not betray which trap went where.
    describe: () => 'Trap…',
  });
}

registerTrap({
  id: 'tripwire',
  name: 'Tripwire',
  icon: '🪤',
  description:
    'Hidden. An enemy piece that travels across this square is stopped on it, short of its destination, and forfeits any bonus move.',
});

registerTrap({
  id: 'sonar',
  name: 'Sonar',
  icon: '📡',
  description:
    'Hidden. When an enemy lands here, it scans the surrounding 3×3 area and reveals every hidden enemy trap inside. Detection only — nothing is disabled.',
});

registerTrap({
  id: 'web-trap',
  name: 'Web Trap',
  icon: '🕸️',
  description:
    'Hidden. The enemy piece that lands here is webbed: it cannot move at its next opportunity, though it stays fully exposed to cards and captures.',
});

registerTrap({
  id: 'mine',
  name: 'Mine',
  icon: '💣',
  description:
    'Hidden. Destroys the enemy piece that lands on it. Destruction, not capture — no on-capture ability triggers, and Kings survive the blast.',
});

registerTrap({
  id: 'dead-zone',
  name: 'Dead Zone',
  icon: '☠️',
  description:
    'Hidden. Arms under the enemy piece that lands here; once that piece leaves by any means, the square becomes impassable terrain for one full round.',
});

/* ------------------------------------------------------------------ */
/* Casting                                                             */
/* ------------------------------------------------------------------ */

/**
 * Central targeting restrictions, applied to every spell stage:
 *  - Null Field: spells may not target squares inside it (traps are exempt —
 *    a trap card is not a spell effect).
 *  - Sacred Ground: piece-pointing stages may not target the protected piece.
 */
function filterStage(
  state: GameState,
  definition: SpellDefinition,
  stage: 0 | 1,
  squares: Square[],
): Square[] {
  if (definition.isTrap) return squares;
  const nulls = nullFieldSquares(state);
  let filtered = nulls.size ? squares.filter((square) => !nulls.has(square)) : squares;
  if (definition.pieceStages?.includes(stage)) {
    filtered = filtered.filter((square) => !isCardImmuneAt(state, square));
  }
  return filtered;
}

/** Legal first targets of a spell for the given caster, or [] if untargeted. */
export function spellPrimaryTargets(state: GameState, caster: Color, spell: string): Square[] {
  const definition = getSpellDefinition(spell);
  return filterStage(state, definition, 0, definition.primaryTargets?.(state, caster) ?? []);
}

export function spellSecondaryTargets(
  state: GameState,
  caster: Color,
  spell: string,
  first: Square,
): Square[] {
  const definition = getSpellDefinition(spell);
  return filterStage(
    state,
    definition,
    1,
    definition.secondaryTargets?.(state, caster, first) ?? [],
  );
}

export function canCastSpells(state: GameState, color: Color): boolean {
  return (
    state.turn === color &&
    state.phase === 'main' &&
    state.pawnOrder === null &&
    state.status !== 'checkmate' &&
    state.spells[color].available.length > 0
  );
}

const expectedTargetCount = (targeting: SpellTargeting): number => {
  if (targeting === 'none') return 0;
  if (targeting === 'friendly-piece' || targeting === 'enemy-piece' || targeting === 'square') {
    return 1;
  }
  return 2;
};

/**
 * Validates and resolves a spell cast. Returns the next game state, or null
 * when the cast is illegal (unknown/used card, bad targets, or a result that
 * leaves the caster's king in check). Casting consumes the turn.
 */
export function castSpell(state: GameState, cast: SpellCast): GameState | null {
  const { color: caster, targets } = cast;
  if (state.status !== 'active' && state.status !== 'check') return null;
  if (state.turn !== caster || state.phase !== 'main') return null;
  if (state.pawnOrder !== null) return null; // a Royal Order demands a move next

  const book = state.spells[caster];
  if (!book.available.includes(cast.spell)) return null;

  let definition: SpellDefinition;
  try {
    definition = getSpellDefinition(cast.spell);
  } catch {
    return null;
  }

  if (definition.castable && !definition.castable(state, caster)) return null;

  if (targets.length !== expectedTargetCount(definition.targeting)) return null;
  if (definition.primaryTargets) {
    const first = targets[0];
    if (first === undefined || !spellPrimaryTargets(state, caster, cast.spell).includes(first)) {
      return null;
    }
    if (definition.secondaryTargets) {
      const second = targets[1];
      if (
        second === undefined ||
        !spellSecondaryTargets(state, caster, cast.spell, first).includes(second)
      ) {
        return null;
      }
    }
  }

  const fenBefore = toFen(state);
  const enemy = opposite(caster);
  const consumedBook = {
    available: book.available.filter((id) => id !== cast.spell),
    used: [...book.used, cast.spell],
    revealed: book.revealed,
  };

  // Royal Order arms a pawn bonus and hands the board back to the caster:
  // the card is spent, but the turn's normal move is still to come.
  if (cast.spell === 'royal-order') {
    const armed: GameState = {
      ...state,
      spells: { ...state.spells, [caster]: consumedBook },
      pawnOrder: { color: caster, stage: 'armed' },
    };
    if (isRoyalAttacked(armed, caster)) return null; // must answer check by moving
    return settle(state, armed, { cast, san: 'Royal Order', fenBefore });
  }

  const changes = definition.resolve(state, caster, targets);

  const next: GameState = {
    ...state,
    ...changes,
    spells: {
      ...(changes.spells ?? state.spells),
      [caster]: {
        ...(changes.spells ?? state.spells)[caster],
        available: consumedBook.available,
        used: consumedBook.used,
      },
    },
    turn: enemy,
    phase: 'main',
    enPassant: null, // an en passant window does not survive a spell turn
    ambush: null, // nor does an ambush window
    pawnOrder: null,
    halfmoveClock: cast.spell === 'sacrifice' ? 0 : state.halfmoveClock + 1,
    fullmoveNumber: caster === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber,
  };

  // King safety: a spell may never end with the caster's king in check —
  // which also forces spells cast while in check to actually answer it.
  if (isRoyalAttacked(next, caster)) return null;

  // A spell can displace or remove a piece that a pending Dead Zone was
  // waiting on (Teleport, Sacrifice) — activate such zones now.
  const trapped = processTraps(next, null, false);

  // The enemy's turn now begins: prune dead targets and expire anything
  // scheduled for this boundary.
  const ticked: GameState = {
    ...next,
    traps: trapped.traps,
    squareStatuses: tickPlies(trapped.squareStatuses),
    regions: tickPlies(next.regions),
    effects: tickEffects(next.effects, next.board, enemy, 'main'),
  };

  const san =
    cast.spell === 'reconnaissance'
      ? `Recon: ${reconPicks(state, caster).map((id) => getSpellDefinition(id).name).join(' + ') || 'nothing'}`
      : definition.describe(targets);

  return settle(state, ticked, { cast, san, fenBefore });
}

/**
 * What a viewer may know about the opponent's cards: null while hidden,
 * the book once Reveal has made it public. UIs must use this instead of
 * reading the opponent's book directly.
 */
export function visibleOpponentSpells(state: GameState, viewer: Color) {
  const enemyBook = state.spells[opposite(viewer)];
  return enemyBook.revealed ? enemyBook : null;
}
