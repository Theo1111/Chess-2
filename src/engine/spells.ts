/**
 * Cards — one-shot actions played instead of a chess move.
 *
 * Cards are data in a registry, exactly like pieces: a definition describes
 * targeting, legality and resolution; `castSpell` is the single entry point
 * that validates a cast, applies it, and passes the turn. Adding a card means
 * registering a definition — the turn system, UI targeting flow, history and
 * persistence pick it up automatically.
 *
 * Five kinds share that one pipeline (`SpellDefinition.kind`). A kind says
 * WHERE THE EFFECT LIVES once the card resolves, and nothing else:
 *
 *   spell   — resolves and is gone; nothing outlives the cast
 *   relic   — a good thing attached to a FRIENDLY piece until spent
 *   curse   — a bad thing attached to an ENEMY piece until it resolves
 *   terrain — state that lives on the board: squares and regions
 *   trap    — board state placed in advance, waiting on an enemy action
 *
 * Classification is NOT a proxy for behaviour. Whether a Null Field can stop
 * a card, and whether playing it hides what it was, are explicit properties
 * on the definition (`blockedByNullField`, `hidden`) precisely so that
 * re-typing a card can never silently change what it does.
 *
 * Enforcement of ongoing effects does NOT live here: a resolved Shield or
 * Freeze is an `ActiveEffect`, applied by the engine's existing funnels
 * (captureRules / isImmobilized). This module only creates them.
 */

import { BOARD_SIZE, fileOf, isInside, makeSquare, rankOf, squareName } from './board';
import {
  blockedSquares,
  isCardImmuneAt,
  isPortal,
  nullFieldSquares,
  regionSquares,
  tickPlies,
  trapAt,
} from './boardEffects';
import { processTraps } from './traps';
import type { RegionEffect, SquareStatus, TrapKind, TrapPlacement } from './boardEffects';
import { beginTurn, hasEffect, pruneEffects } from './effects';
import type { ActiveEffect } from './effects';
import { isImmobilized } from './auras';
import { settle } from './game';
import { isRoyalAttacked, royalSquares } from './moveGeneration';
import { toFen } from './fen';
import { changeType } from './apply';
import { allPieceDefinitions, getPieceDefinition } from './pieces';
import type { PieceClass } from './pieces';
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
  | 'friendly-piece-then-adjacent-enemy'
  | 'square-then-square'
  | 'square-then-adjacent-square';

/**
 * Where a card's effect lives after it resolves. This is a classification for
 * players and for grouping the catalog — no rule is derived from it. See the
 * explicit properties on `SpellDefinition` for the mechanics.
 */
export type CardKind = 'spell' | 'trap' | 'relic' | 'curse' | 'terrain';

/** Which selection stages of a targeting mode point at a PIECE. */
export function pieceTargetStages(targeting: SpellTargeting): readonly (0 | 1)[] {
  switch (targeting) {
    case 'friendly-piece':
    case 'enemy-piece':
    case 'friendly-piece-then-square':
      return [0];
    case 'friendly-piece-then-adjacent-enemy':
      return [0, 1];
    default:
      return [];
  }
}

export interface SpellDefinition {
  readonly id: string;
  readonly name: string;
  /** Emoji used on the card and in compact UI. */
  readonly icon: string;
  /** Where the effect lives once played. Defaults to 'spell'. */
  readonly kind: CardKind;
  /**
   * Whether a Null Field suppresses this card. Stated per card, never
   * inferred from `kind`: re-typing a card must not silently change what can
   * stop it. Defaults to true — a card is magic unless it says otherwise.
   * (Traps are mechanisms and Wall/Portal are masonry, so those say false.)
   */
  readonly blockedByNullField: boolean;
  /**
   * Whether playing this card conceals what it was: the opponent sees that a
   * card was played but not which, and the UI keeps it face down until the
   * game itself turns it over. True for traps today; it is a property of the
   * card rather than of its kind, so a visible trap or a hidden spell would
   * both work without touching a rule.
   */
  readonly hidden: boolean;
  readonly description: string;
  /**
   * Roster point cost — cards share the army budget with pieces. Data here,
   * exactly like piece costs, so the builder, validation and the balance
   * laboratory all read one source of truth. Omitted = free.
   */
  readonly cost?: number;
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
  readonly resolve: (
    state: GameState,
    caster: Color,
    targets: readonly Square[],
    choice?: PieceType,
  ) => Partial<GameState>;
  /**
   * Cards that also ask their caster to name a piece — the Transform curse
   * picks what its victim becomes. Given the chosen targets, the legal
   * answers; a card without this must not be handed a choice.
   */
  readonly choices?: (
    state: GameState,
    caster: Color,
    targets: readonly Square[],
  ) => PieceType[];
  /** History label, e.g. "Shield→e4". */
  readonly describe: (targets: readonly Square[], choice?: PieceType) => string;
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
   * A card that is not in the public catalog. The draft only offers it to
   * clients that have unlocked secrets (admin accounts); the engine plays it
   * like any other card, because the engine does not know what an account is.
   */
  readonly secret?: boolean;
  /**
   * Full card-face artwork (a public asset path). Cards without art fall
   * back to their icon-and-text presentation.
   */
  readonly artwork?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const registry = new Map<string, SpellDefinition>();

/**
 * The official card-face art set. Royal Order, Tripwire, Mine and the secret
 * card await theirs. (The first kit's manifest labelled the Shield card
 * "royal_order" — the artwork itself is titled Shield and carries Shield's
 * rules text, so it is mapped by content, not by filename. The corrected kit
 * that brought the relics, curses and terrain needed no such untangling: each
 * file depicts the card it is named after.)
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
  'mirror-shield': '/card_art/mirror-shield.png',
  'crown-of-command': '/card_art/crown-of-command.png',
  decay: '/card_art/decay.png',
  transform: '/card_art/transform.png',
  wall: '/card_art/wall.png',
  portal: '/card_art/portal.png',
};

/**
 * Fills in what a registration leaves out: `kind` defaults to 'spell', a card
 * is stopped by a Null Field unless it says otherwise, and only a card that
 * asks to be hidden is. `isTrap` stays as the shorthand for `kind === 'trap'`
 * that deck routing and the builder read.
 */
export function registerSpell(definition: RegisteredCard): void {
  const kind: CardKind = definition.kind ?? (definition.isTrap === true ? 'trap' : 'spell');
  const artwork = definition.artwork ?? CARD_ARTWORK[definition.id];
  registry.set(definition.id, {
    ...definition,
    kind,
    isTrap: kind === 'trap',
    blockedByNullField: definition.blockedByNullField ?? true,
    hidden: definition.hidden ?? false,
    ...(artwork ? { artwork } : {}),
  });
}

/** What a card registration may leave out — everything with a default. */
type RegisteredCard = Omit<SpellDefinition, 'kind' | 'blockedByNullField' | 'hidden'> & {
  readonly kind?: CardKind;
  readonly blockedByNullField?: boolean;
  readonly hidden?: boolean;
};

/** Every card of one kind, in registry order. */
export const cardsOfKind = (kind: CardKind): SpellDefinition[] =>
  [...registry.values()].filter((definition) => definition.kind === kind);

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

/*
 * Card point costs — evidence-based, not uniform.
 *
 * Priced from the 25,000-game GreedyBot baseline (balance-results/
 * baseline-v1, seed 42): each spell's cost tracks its adjusted marginal win
 * contribution in the logistic model (+2.6pp Shield/Last Stand → 4pts, down
 * to −3.2pp Recon → 1pt). Trap coefficients were unidentifiable in that run
 * (the old fixed loadout put all five traps in every army — zero selection
 * variance), so traps are priced from behavioral telemetry instead: Mine and
 * Web Trap fire most with material/tempo impact (2), Tripwire/Sonar/Dead
 * Zone rarely fire or only gather information (1). Smoke Screen and Recon
 * are modelled at limited fidelity — their prices are the least trusted and
 * first in line for re-pricing once information-set search exists.
 */

/* ------------------------------------------------------------------ */
/* The five starter cards                                              */
/* ------------------------------------------------------------------ */

registerSpell({
  id: 'shield',
  name: 'Shield',
  // A good thing that lives on a friendly piece until it expires.
  kind: 'relic',
  icon: '🛡️',
  cost: 4,
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
  cost: 2,
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
  // The effect lives on the enemy piece it holds still.
  kind: 'curse',
  icon: '❄️',
  cost: 1,
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
  cost: 1,
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
  cost: 3,
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
  // A region of the board behaves differently while it lasts.
  kind: 'terrain',
  icon: '🌫️',
  cost: 2,
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
  cost: 1,
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
  cost: 3,
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
  // The extra hit point lives on the piece it was given to.
  kind: 'relic',
  icon: '🔰',
  cost: 4,
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
  cost: 2,
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
  // A region of the board behaves differently while it lasts.
  kind: 'terrain',
  icon: '🌀',
  cost: 1,
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
  // The square itself gains a property.
  kind: 'terrain',
  icon: '🌟',
  cost: 2,
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
  cost: number;
  description: string;
}): void {
  registerSpell({
    id: config.id,
    name: config.name,
    icon: config.icon,
    cost: config.cost,
    description: config.description,
    targeting: 'square',
    isTrap: true,
    // A trap is a mechanism, not a spell, so anti-magic does not reach it —
    // and setting one must not announce which one it was.
    blockedByNullField: false,
    hidden: true,
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
  cost: 1,
  description:
    'Hidden. An enemy piece that travels across this square is stopped on it, short of its destination, and forfeits any bonus move.',
});

registerTrap({
  id: 'sonar',
  name: 'Sonar',
  icon: '📡',
  cost: 1,
  description:
    'Hidden. When an enemy lands here, it scans the surrounding 3×3 area and reveals every hidden enemy trap inside. Detection only — nothing is disabled.',
});

registerTrap({
  id: 'web-trap',
  name: 'Web Trap',
  icon: '🕸️',
  cost: 2,
  description:
    'Hidden. The enemy piece that lands here is webbed: it cannot move at its next opportunity, though it stays fully exposed to cards and captures.',
});

registerTrap({
  id: 'mine',
  name: 'Mine',
  icon: '💣',
  cost: 2,
  description:
    'Hidden. Destroys the enemy piece that lands on it. Destruction, not capture — no on-capture ability triggers, and Kings survive the blast.',
});

registerTrap({
  id: 'dead-zone',
  name: 'Dead Zone',
  icon: '☠️',
  cost: 1,
  description:
    'Hidden. Arms under the enemy piece that lands here; once that piece leaves by any means, the square becomes impassable terrain for one full round.',
});


/* ------------------------------------------------------------------ */
/* The relic, curse and terrain batch                                  */
/*                                                                     */
/* Kind is a field, not a position in this file: the cards above carry  */
/* their own `kind` too (Shield is a relic, Freeze a curse, Smoke       */
/* Screen terrain). These are simply the ones that arrived together.    */
/* ------------------------------------------------------------------ */

/** Squares a card may build on: empty, unblocked, and not already claimed. */
const buildableSquares = (state: GameState): Square[] => {
  const blocked = blockedSquares(state);
  const squares: Square[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    if (state.board[square] || blocked.has(square)) continue;
    if (trapAt(state, square)) continue;
    if (isPortal(state, square)) continue;
    squares.push(square);
  }
  return squares;
};

const orthogonalNeighbours = (square: Square): Square[] => {
  const file = fileOf(square);
  const rank = rankOf(square);
  const out: Square[] = [];
  for (const [df, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (isInside(file + df, rank + dr)) out.push(makeSquare(file + df, rank + dr));
  }
  return out;
};

/** Pieces already wearing this relic — a second copy would do nothing. */
const withoutEffect = (state: GameState, squares: Square[], kind: ActiveEffect['kind']): Square[] =>
  squares.filter((square) => {
    const piece = state.board[square];
    return piece !== null && piece !== undefined && !hasEffect(state.effects, kind, piece.id);
  });

registerSpell({
  id: 'mirror-shield',
  name: 'Mirror Shield',
  icon: '🪞',
  kind: 'relic',
  cost: 3,
  description:
    'Equip a friendly piece. The first enemy card that targets it is turned aside — that card is spent for nothing, and so is this relic.',
  targeting: 'friendly-piece',
  pieceStages: [0],
  primaryTargets: (state, caster) =>
    withoutEffect(state, friendlyPieces(state, caster, true), 'mirror-shield'),
  resolve: (state, caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    return {
      effects: [
        ...state.effects,
        {
          id: `mirror-shield:${piece.id}:${state.fullmoveNumber}`,
          kind: 'mirror-shield' as const,
          caster,
          targetPieceId: piece.id,
          // Worn until an enemy card breaks on it.
          expiresAtTurnStartOf: null,
        },
      ],
    };
  },
  describe: (targets) => `Mirror Shield→${squareName(targets[0]!)}`,
});

registerSpell({
  id: 'crown-of-command',
  name: 'Crown of Command',
  icon: '👑',
  kind: 'relic',
  cost: 4,
  description:
    'Equip a non-royal friendly piece. The next time it moves, one of your Pawns may immediately make an extra move. The crown is then spent.',
  targeting: 'friendly-piece',
  pieceStages: [0],
  // A crown with no Pawn to command is a wasted card.
  castable: (state, caster) =>
    state.board.some(
      (piece) => piece?.color === caster && classOfPiece(piece.type) === 'pawn',
    ),
  primaryTargets: (state, caster) =>
    withoutEffect(state, friendlyPieces(state, caster, false), 'crown'),
  resolve: (state, caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    return {
      effects: [
        ...state.effects,
        {
          id: `crown:${piece.id}:${state.fullmoveNumber}`,
          kind: 'crown' as const,
          caster,
          targetPieceId: piece.id,
          expiresAtTurnStartOf: null,
        },
      ],
    };
  },
  describe: (targets) => `Crown of Command→${squareName(targets[0]!)}`,
});

/** Two rounds: one turn each, twice. */
const WALL_PLIES = 4;

registerSpell({
  id: 'wall',
  name: 'Wall',
  icon: '🧱',
  kind: 'terrain',
  // Masonry, not magic: a Null Field never stopped it being built, and this
  // is that rule stated rather than inferred from the word "terrain". The
  // older region cards (Smoke Screen, Null Field, Sacred Ground) are magic
  // and stay suppressible — being re-typed as terrain changed nothing.
  blockedByNullField: false,
  cost: 3,
  description:
    'Raise a wall across two adjacent empty squares. Nothing may stand on them or move through them for two rounds.',
  targeting: 'square-then-adjacent-square',
  primaryTargets: (state) =>
    buildableSquares(state).filter((square) => {
      const open = new Set(buildableSquares(state));
      return orthogonalNeighbours(square).some((neighbour) => open.has(neighbour));
    }),
  secondaryTargets: (state, _caster, first) => {
    const open = new Set(buildableSquares(state));
    return orthogonalNeighbours(first).filter((square) => open.has(square));
  },
  resolve: (state, caster, targets) => ({
    squareStatuses: [
      ...state.squareStatuses,
      ...targets.map((square) => ({
        id: `wall:${square}:${state.fullmoveNumber}:${caster[0]}`,
        kind: 'wall' as const,
        owner: caster,
        square,
        pliesRemaining: WALL_PLIES,
      })),
    ],
  }),
  describe: (targets) => `Wall→${squareName(targets[0]!)}+${squareName(targets[1]!)}`,
});

registerSpell({
  id: 'portal',
  name: 'Portal',
  icon: '🌀',
  kind: 'terrain',
  // As Wall: construction, unaffected by anti-magic. See the note there.
  blockedByNullField: false,
  cost: 3,
  description:
    'Open a gate on each of two empty squares. A piece standing on one may step out of the other, arriving without crossing the ground between. The gates stay open.',
  targeting: 'square-then-square',
  primaryTargets: (state) => (buildableSquares(state).length >= 2 ? buildableSquares(state) : []),
  secondaryTargets: (state, _caster, first) =>
    buildableSquares(state).filter((square) => square !== first),
  resolve: (state, caster, targets) => ({
    portals: [
      ...state.portals,
      {
        id: `portal:${targets[0]!}-${targets[1]!}:${state.fullmoveNumber}`,
        owner: caster,
        squares: [targets[0]!, targets[1]!] as const,
      },
    ],
  }),
  describe: (targets) => `Portal→${squareName(targets[0]!)}⇄${squareName(targets[1]!)}`,
});

/** Turns its owner still gets with the cursed piece before it crumbles. */
const DECAY_TURNS = 3;

registerSpell({
  id: 'decay',
  name: 'Decay',
  icon: '🦠',
  kind: 'curse',
  cost: 4,
  description:
    'Curse an enemy piece. After three of its owner’s turns it crumbles to dust — destroyed, not captured. Kings and Queen-class pieces are too strong to rot.',
  targeting: 'enemy-piece',
  pieceStages: [0],
  primaryTargets: (state, caster) =>
    withoutEffect(
      state,
      enemyPieces(state, caster, false).filter(
        (square) => classOfPiece(state.board[square]!.type) !== 'queen',
      ),
      'decay',
    ),
  resolve: (state, caster, [target]) => {
    const piece = state.board[target!];
    if (!piece) return {};
    return {
      effects: [
        ...state.effects,
        {
          id: `decay:${piece.id}:${state.fullmoveNumber}`,
          kind: 'decay' as const,
          caster,
          targetPieceId: piece.id,
          expiresAtTurnStartOf: null,
          // One more than the promised turns: the cast itself ends the
          // caster's turn, so the first countdown lands on the victim's
          // turn as it begins — before they have had it for a turn at all.
          turnsRemaining: DECAY_TURNS + 1,
        },
      ],
    };
  },
  describe: (targets) => `Decay→${squareName(targets[0]!)}`,
});

/**
 * The demotion ladder. Bishops and Knights share a rung, so one may not be
 * turned into the other — only down into a Pawn-class piece.
 */
const CLASS_RANK: Readonly<Record<PieceClass, number>> = {
  king: 5,
  queen: 4,
  rook: 3,
  bishop: 2,
  knight: 2,
  pawn: 1,
};

/** Every piece strictly below `type` on the ladder. Royals are never on it. */
export function lesserPieceTypes(type: PieceType): PieceType[] {
  const own = classOfPiece(type);
  if (own === undefined) return [];
  const rank = CLASS_RANK[own];
  return allPieceDefinitions()
    .filter(
      (definition) =>
        definition.pieceClass !== undefined &&
        !definition.royal &&
        CLASS_RANK[definition.pieceClass] < rank,
    )
    .map((definition) => definition.type)
    .sort();
}

registerSpell({
  id: 'transform',
  name: 'Transform',
  icon: '🐸',
  kind: 'curse',
  cost: 5,
  description:
    'Curse an enemy piece into a lesser one of your choosing: Queen-class → Rook-class → Bishop/Knight-class → Pawn-class. A King is beyond the spell.',
  targeting: 'enemy-piece',
  pieceStages: [0],
  primaryTargets: (state, caster) =>
    enemyPieces(state, caster, false).filter(
      (square) => lesserPieceTypes(state.board[square]!.type).length > 0,
    ),
  choices: (state, _caster, targets) => {
    const piece = state.board[targets[0]!];
    return piece ? lesserPieceTypes(piece.type) : [];
  },
  resolve: (state, _caster, [target], choice) => {
    const piece = state.board[target!];
    if (!piece || choice === undefined) return {};
    const board = state.board.slice();
    board[target!] = changeType(piece, choice);
    // The piece is a new one as far as identity goes, so anything attached
    // to the old shape — a Mirror Shield, a Decay — falls off with it.
    return { board, effects: pruneEffects(state.effects, board) };
  },
  describe: (targets, choice) =>
    `Transform→${squareName(targets[0]!)}=${choice ? getPieceDefinition(choice).name : '?'}`,
});


/* ------------------------------------------------------------------ */
/* The secret card                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ruler's Authority — a joke card, and deliberately a broken one.
 *
 * It is `secret`, so the Army Builder only offers it to an admin account
 * (see `roster/availability.ts`, and the server-side gate on submitting an
 * online army in `supabase/admin.sql`). The engine treats it as an ordinary
 * untargeted card: one side ends the turn with a King and nothing else, which
 * `computeStatus` reads as an annihilation.
 */
registerSpell({
  id: 'rulers-authority',
  name: "Ruler's Authority",
  icon: '⚡',
  kind: 'spell',
  secret: true,
  cost: 0,
  description:
    'The Ruler speaks once. Every piece on the board is annihilated but your King — and every trap, ward, wall and gate with them. Nothing is left to argue with.',
  targeting: 'none',
  // The Ruler must be alive to give the order.
  castable: (state, caster) => royalSquares(state.board, caster).length > 0,
  resolve: (state, caster) => {
    const board = state.board.slice();
    let reserves = state.reserves;

    for (let square = 0; square < BOARD_SIZE; square++) {
      const piece = board[square];
      if (!piece) continue;
      // The one exception, and the whole joke.
      if (piece.color === caster && getPieceDefinition(piece.type).royal) continue;
      board[square] = null;
      // Destruction, not capture: nothing is credited to anyone.
      reserves = { ...reserves, [piece.color]: [...reserves[piece.color], piece.type] };
    }

    return {
      board,
      reserves,
      effects: [],
      traps: [],
      regions: [],
      squareStatuses: [],
      portals: [],
    };
  },
  describe: () => "Ruler's Authority",
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
  let filtered = squares;

  // Null Field: read from the card's own flag, not from what kind of card it
  // is. Calling something terrain does not make it immune to anything.
  if (definition.blockedByNullField) {
    const nulls = nullFieldSquares(state);
    if (nulls.size) filtered = filtered.filter((square) => !nulls.has(square));
  }

  // Sacred Ground: only stages that actually point at a piece can be barred
  // by the occupant's immunity, which `pieceStages` already states outright.
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
 * The relic that stops this cast, if the card points at a piece wearing one.
 * Only an ENEMY piece's shield deflects: your own relic never turns aside
 * your own Shield or Teleport.
 */
function mirrorShieldAgainst(
  state: GameState,
  definition: SpellDefinition,
  caster: Color,
  targets: readonly Square[],
): ActiveEffect | undefined {
  if (state.effects.length === 0) return undefined;
  for (const stage of pieceTargetStages(definition.targeting)) {
    const square = targets[stage];
    if (square === undefined) continue;
    const piece = state.board[square];
    if (!piece || piece.color === caster) continue;
    const shield = state.effects.find(
      (effect) => effect.kind === 'mirror-shield' && effect.targetPieceId === piece.id,
    );
    if (shield) return shield;
  }
  return undefined;
}

/**
 * True if a Mirror Shield would break this cast before it resolves — which
 * means it changes nothing at all. Exported because the action layer has to
 * model the same rule to keep its legality probe honest (see actions.ts).
 */
export function castWouldBeDeflected(
  state: GameState,
  spell: string,
  caster: Color,
  targets: readonly Square[],
): boolean {
  let definition: SpellDefinition;
  try {
    definition = getSpellDefinition(spell);
  } catch {
    return false;
  }
  return mirrorShieldAgainst(state, definition, caster, targets) !== undefined;
}

/**
 * Crosses the turn boundary a cast creates: board effects age, curses count
 * down, and anything that crumbled joins its owner's reserves.
 */
function endTurn(state: GameState, enemy: Color): GameState {
  const started = beginTurn(state.board, state.effects, enemy, 'main');
  let reserves = state.reserves;
  for (const lost of started.decayed) {
    reserves = { ...reserves, [lost.color]: [...reserves[lost.color], lost.type] };
  }
  return {
    ...state,
    board: started.board,
    effects: started.effects,
    reserves,
    squareStatuses: tickPlies(state.squareStatuses),
    regions: tickPlies(state.regions),
  };
}

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

  // A card that names a piece as well as a square must name a legal one —
  // and a card that asks for no such choice must not be handed one.
  if (definition.choices) {
    const allowed = definition.choices(state, caster, targets);
    if (cast.choice === undefined || !allowed.includes(cast.choice)) return null;
  } else if (cast.choice !== undefined) {
    return null;
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

  // A Mirror Shield turns aside the first enemy card that points at its
  // wearer: the card is spent for nothing, and so is the relic. Checked
  // before resolution, so the card never touches the board at all.
  const deflector = mirrorShieldAgainst(state, definition, caster, targets);
  if (deflector) {
    const fizzled: GameState = {
      ...state,
      spells: { ...state.spells, [caster]: consumedBook },
      effects: state.effects.filter((effect) => effect.id !== deflector.id),
      turn: enemy,
      phase: 'main',
      enPassant: null,
      ambush: null,
      pawnOrder: null,
      halfmoveClock: state.halfmoveClock + 1,
      fullmoveNumber: caster === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber,
    };
    // Spending a turn on a card that fizzles still may not leave your own
    // king in check — a cast made under check has to answer it.
    if (isRoyalAttacked(fizzled, caster)) return null;
    return settle(state, endTurn(fizzled, enemy), {
      cast,
      san: `${definition.name}✗`,
      fenBefore,
    });
  }

  const changes = definition.resolve(state, caster, targets, cast.choice);

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

  // The enemy's turn now begins: prune dead targets, expire anything
  // scheduled for this boundary, and let curses count down.
  const ticked = endTurn({ ...next, traps: trapped.traps, squareStatuses: trapped.squareStatuses }, enemy);

  const san =
    cast.spell === 'reconnaissance'
      ? `Recon: ${reconPicks(state, caster).map((id) => getSpellDefinition(id).name).join(' + ') || 'nothing'}`
      : definition.describe(targets, cast.choice);

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
