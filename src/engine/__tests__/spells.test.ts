import { describe, expect, it } from 'vitest';
import '../customPieces';
import '../rookPieces';
import '../knightPieces';
import '../bishopPieces';
import { parseSquareName, squareName } from '../board';
import { applyMove, createInitialState, createStateFromFen } from '../game';
import { findLegalMove, generateLegalMovesFrom, isInCheck } from '../moveGeneration';
import {
  castSpell,
  getSpellDefinition,
  spellPrimaryTargets,
  spellSecondaryTargets,
  visibleOpponentSpells,
} from '../spells';
import { isFrozen, isShielded } from '../effects';
import type { Color, GameState, Square } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const targets = (state: GameState, from: string): string[] =>
  [...new Set(generateLegalMovesFrom(state, sq(from)).map((move) => squareName(move.to)))].sort();

const play = (state: GameState, from: string, to: string): GameState => {
  const move = findLegalMove(state, sq(from), sq(to));
  expect(move, `expected ${from}${to} to be legal`).not.toBeNull();
  return applyMove(state, move!);
};

const cast = (state: GameState, color: Color, spell: string, ...names: string[]): GameState => {
  const next = castSpell(state, { spell, color, targets: names.map(sq) });
  expect(next, `expected ${spell} by ${color} on [${names.join(',')}] to be legal`).not.toBeNull();
  return next!;
};

const tryCast = (state: GameState, color: Color, spell: string, ...names: string[]) =>
  castSpell(state, { spell, color, targets: names.map(sq) });

const pieceAt = (state: GameState, name: string) => state.board[sq(name)];

describe('spell system', () => {
  it('every player starts a Chess 2 game with the full card set', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K8 w - - 0 1');
    for (const color of ['white', 'black'] as const) {
      expect(state.spells[color].available).toContain('shield');
      expect(state.spells[color].available).toContain('sacrifice');
      expect(state.spells[color].available).toContain('tripwire');
      expect(state.spells[color].available).toHaveLength(17);
      expect(state.spells[color].used).toEqual([]);
    }
  });

  it('classic chess starts with spells disabled', () => {
    const state = createInitialState();
    expect(state.spells.white.available).toEqual([]);
    expect(state.spells.black.available).toEqual([]);
  });

  it('casting consumes the card and the turn', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const after = cast(state, 'white', 'shield', 'd1');
    expect(after.turn).toBe('black');
    expect(after.spells.white.available).not.toContain('shield');
    expect(after.spells.white.used).toContain('shield');
    expect(after.history.at(-1)?.san).toBe('Shield→d1');
    expect(after.history.at(-1)?.cast?.spell).toBe('shield');
  });

  it('a used card cannot be cast again', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    let game = cast(state, 'white', 'shield', 'd1');
    game = play(game, 'a8', 'b8');
    expect(tryCast(game, 'white', 'shield', 'd1')).toBeNull();
  });

  it('unknown cards and out-of-turn casts are rejected', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(state, 'white', 'meteor', 'd1')).toBeNull();
    expect(tryCast(state, 'black', 'shield', 'a8')).toBeNull(); // not black's turn
  });

  it('the official art set is mapped onto the card definitions', () => {
    const withArt = [
      'shield', 'reveal', 'freeze', 'teleport', 'sacrifice', 'smoke-screen',
      'reconnaissance', 'last-stand', 'interference',
      'null-field', 'sacred-ground', 'sonar', 'web-trap', 'dead-zone',
    ];
    for (const id of withArt) {
      expect(getSpellDefinition(id).artwork, id).toBe(`/card_art/${id}.png`);
    }
    // No art shipped for these three — they fall back to icon tiles.
    for (const id of ['royal-order', 'tripwire', 'mine']) {
      expect(getSpellDefinition(id).artwork, id).toBeUndefined();
    }
  });

  it('spell state round-trips through JSON', () => {
    const state = cast(createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1'), 'white', 'shield', 'd1');
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    expect(clone.spells.white.used).toContain('shield');
    expect(clone.effects).toHaveLength(1);
    expect(isShielded(clone.effects, pieceAt(clone, 'd1')!.id)).toBe(true);
  });
});

describe('Shield', () => {
  it('targets friendly non-royal pieces only', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R3r1 w - - 0 1');
    const options = spellPrimaryTargets(state, 'white', 'shield').map(squareName);
    expect(options).toEqual(['d1']); // not the king, not the enemy rook
    expect(tryCast(state, 'white', 'shield', 'h1')).toBeNull(); // enemy piece
    expect(tryCast(state, 'white', 'shield', 'a1')).toBeNull(); // own king
  });

  it('prevents normal captures for one enemy turn, then expires', () => {
    // Black rook on d8 stares at the white rook on d1.
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'shield', 'd1');
    // Black cannot take the shielded rook.
    expect(targets(state, 'd8')).not.toContain('d1');
    state = play(state, 'd8', 'd2'); // black comes closer instead
    // White's turn begins: the shield has expired.
    expect(state.effects).toHaveLength(0);
    state = play(state, 'a1', 'b1');
    expect(targets(state, 'd2')).toContain('d1'); // now capturable again
  });

  it('a shielded piece still moves and captures', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/3p5/K2R5 w - - 0 1');
    state = cast(state, 'white', 'shield', 'd1');
    state = play(state, 'd8', 'd4');
    expect(targets(state, 'd1')).toContain('d2'); // capture the pawn
    const after = play(state, 'd1', 'd2');
    expect(after.captured.white).toEqual(['pawn']);
  });

  it('blocks special captures: catapult hop, spearman stab, ram crush, jouster charge', () => {
    // Catapult: black o on d8, screen on d5, white rook d2 shielded.
    let hop = createStateFromFen('9/k2o5/9/9/3p5/9/9/3R5/K8 w - - 0 1');
    hop = cast(hop, 'white', 'shield', 'd2');
    expect(targets(hop, 'd8')).not.toContain('d2');

    // Spearman: black ê on h8 staring down at the shielded rook on c3.
    let stab = createStateFromFen('9/k6ê1/9/9/9/9/2R6/9/K8 w - - 0 1');
    stab = cast(stab, 'white', 'shield', 'c3');
    expect(generateLegalMovesFrom(stab, sq('h8')).every((m) => !m.captured)).toBe(true);

    // Ram: black x on d6 two above the shielded rook on d4.
    let crush = createStateFromFen('9/k8/9/3x5/9/3R5/9/9/K8 w - - 0 1');
    crush = cast(crush, 'white', 'shield', 'd4');
    expect(targets(crush, 'd6')).not.toContain('d4');

    // Jouster: with the capture barred, the whole direction is barred.
    let charge = createStateFromFen('9/k2j5/9/9/9/9/9/9/K2R5 w - - 0 1');
    charge = cast(charge, 'white', 'shield', 'd1');
    expect(targets(charge, 'd8')).not.toContain('d1');
  });

  it('blocks en passant on a shielded pawn', () => {
    // With the 1-turn starter Shield this state cannot arise naturally (the
    // shield expires before the pusher becomes capturable), but the funnel
    // must hold for future longer-lived shields: inject the effect directly.
    let state = createStateFromFen('9/k8/9/9/9/3p5/9/2P6/K8 w - - 0 1');
    state = play(state, 'c2', 'c4'); // double push beside the black pawn
    expect(state.enPassant).toBe(sq('c3'));
    expect(targets(state, 'd4')).toContain('c3'); // ep available normally

    const pusher = pieceAt(state, 'c4')!;
    const shielded: GameState = {
      ...state,
      effects: [
        {
          id: 'shield:test',
          kind: 'shield',
          caster: 'white',
          targetPieceId: pusher.id,
          expiresAtTurnStartOf: 'white',
        },
      ],
    };
    expect(targets(shielded, 'd4')).not.toContain('c3'); // ep barred by shield
  });

  it('shield + champion coexist: armour still works after expiry', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2H5 w - - 0 1');
    state = cast(state, 'white', 'shield', 'd1');
    expect(targets(state, 'd8')).not.toContain('d1'); // no capture, no repel
    state = play(state, 'd8', 'd4');
    state = play(state, 'a1', 'b1'); // shield expires at white's turn start
    state = play(state, 'a8', 'b8');
    // Champion armour is intact: the rook attack is a repel, not a capture.
    expect(state.effects).toHaveLength(0);
    state = play(state, 'b8', 'a8');
    const repel = generateLegalMovesFrom(state, sq('d4')).find((m) => squareName(m.to) === 'd1');
    expect(repel?.repelled).toBe(true);
  });

  it('a warhound whose only prey is shielded is not forced', () => {
    let state = createStateFromFen('9/k2ñ5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'shield', 'd1');
    const reach = targets(state, 'd8');
    expect(reach).not.toContain('d1');
    expect(reach.length).toBeGreaterThan(1); // free queen movement
  });

  it('cannot be cast while it leaves the king in check', () => {
    // White is in check; shielding a bystander does not answer it.
    const state = createStateFromFen('9/k3r4/9/9/9/9/9/9/3RK4 w - - 0 1');
    expect(isInCheck(state, 'white')).toBe(true);
    expect(tryCast(state, 'white', 'shield', 'd1')).toBeNull();
  });
});

describe('Reveal', () => {
  it('needs no target and exposes the opponent’s remaining cards permanently', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    // Hidden before.
    expect(visibleOpponentSpells(state, 'white')).toBeNull();

    state = cast(state, 'white', 'reveal');
    const seen = visibleOpponentSpells(state, 'white');
    expect(seen).not.toBeNull();
    expect(seen?.available).toHaveLength(17);
    expect(seen?.available).toContain('shield');

    // Black burns a card; the view keeps tracking availability.
    state = cast(state, 'black', 'freeze', 'd1');
    expect(visibleOpponentSpells(state, 'white')?.available).not.toContain('freeze');

    // Reveal itself was consumed, and black still cannot see white's cards.
    expect(state.spells.white.used).toContain('reveal');
    expect(visibleOpponentSpells(state, 'black')).toBeNull();
  });
});

describe('Freeze', () => {
  it('targets enemy non-royal pieces only', () => {
    const state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    const options = spellPrimaryTargets(state, 'white', 'freeze').map(squareName);
    expect(options).toEqual(['d8']);
    expect(tryCast(state, 'white', 'freeze', 'd1')).toBeNull(); // own piece
    expect(tryCast(state, 'white', 'freeze', 'a8')).toBeNull(); // enemy king
  });

  it('freezes for exactly the opponent’s turn', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'freeze', 'd8');
    expect(isFrozen(state.effects, pieceAt(state, 'd8')!.id)).toBe(true);
    expect(targets(state, 'd8')).toEqual([]); // cannot move at all
    state = play(state, 'a8', 'b8'); // black must do something else
    // White's turn: freeze expired.
    expect(state.effects).toHaveLength(0);
    state = play(state, 'a1', 'b1');
    expect(targets(state, 'd8').length).toBeGreaterThan(0);
  });

  it('a frozen piece can still be captured', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'freeze', 'd8');
    state = play(state, 'a8', 'b8');
    const after = play(state, 'd1', 'd8');
    expect(after.captured.white).toEqual(['rook']);
    expect(after.effects).toHaveLength(0); // effect died with the piece
  });

  it('a frozen warhound is not compelled and simply cannot act', () => {
    let state = createStateFromFen('9/k2ñ5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'freeze', 'd8');
    expect(targets(state, 'd8')).toEqual([]);
  });

  it('freezing the checking piece answers check', () => {
    const state = createStateFromFen('9/k3r4/9/9/9/9/9/9/3RK4 w - - 0 1');
    expect(isInCheck(state, 'white')).toBe(true);
    const frozenCheck = cast(state, 'white', 'freeze', 'e8');
    expect(isInCheck(frozenCheck, 'white')).toBe(false); // frozen pieces do not attack
  });
});

describe('Teleport', () => {
  it('offers only empty same-colour destinations', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    // d1 is a light square? d1: file 3 + rank 0 = 3, odd → light in our terms.
    const options = spellSecondaryTargets(state, 'white', 'teleport', sq('d1')).map(squareName);
    expect(options).toContain('f1'); // same colour
    expect(options).not.toContain('e1'); // other colour
    expect(options).not.toContain('d1'); // its own square
    expect(options).not.toContain('a1'); // occupied (own king — also wrong colour anyway)
    for (const name of options) {
      const square = sq(name);
      expect((square % 9) + Math.floor(square / 9)).toSatisfy(
        (n: number) => n % 2 === (3 % 2), // d1 parity: file 3 + rank 0
      );
    }
  });

  it('moves the piece directly, consuming the turn', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const after = cast(state, 'white', 'teleport', 'd1', 'h5');
    expect(pieceAt(after, 'd1')).toBeNull();
    expect(pieceAt(after, 'h5')).toMatchObject({ type: 'rook', color: 'white' });
    expect(after.turn).toBe('black');
    expect(after.history.at(-1)?.san).toBe('Teleport d1→h5');
  });

  it('cannot land on occupied squares or capture', () => {
    const state = createStateFromFen('9/k8/9/9/7r1/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(state, 'white', 'teleport', 'd1', 'h5')).toBeNull(); // enemy there
  });

  it('cannot expose the king by leaving', () => {
    // The rook on e2 blocks the e-file rook's check.
    const state = createStateFromFen('9/k3r4/9/9/9/9/9/4R4/4K4 w - - 0 1');
    expect(tryCast(state, 'white', 'teleport', 'e2', 'c4')).toBeNull();
  });

  it('can teleport the king, but never into check', () => {
    const state = createStateFromFen('9/k3r4/9/9/9/9/9/9/3K5 w - - 0 1');
    // d1 is dark; e1... craft: king d1 (file3+rank0=3): teleport to b3 (1+2=3 same parity) fine,
    // but not onto the e-file… e-file squares of same colour: e2? 4+1=5 — different parity anyway.
    const after = tryCast(state, 'white', 'teleport', 'd1', 'b3');
    expect(after).not.toBeNull();
    // A same-colour square on the rook's file is refused.
    expect(tryCast(state, 'white', 'teleport', 'd1', 'e4'.replace('e4', 'e2'))).toBeNull();
  });

  it('works for movement-restricted custom pieces, but not frozen ones', () => {
    // A Jailer with range 0 (no pawns captured) may still teleport.
    const jailer = createStateFromFen('9/k8/9/9/9/3Ï5/9/9/K8 w - - 0 1');
    expect(targets(jailer, 'd4')).toEqual([]);
    expect(tryCast(jailer, 'white', 'teleport', 'd4', 'f6')).not.toBeNull();

    // A frozen piece cannot.
    let frozen = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 b - - 0 1');
    frozen = cast(frozen, 'black', 'freeze', 'd1');
    expect(spellPrimaryTargets(frozen, 'white', 'teleport').map(squareName)).not.toContain('d1');
    expect(tryCast(frozen, 'white', 'teleport', 'd1', 'f1')).toBeNull();
  });
});

describe('Sacrifice', () => {
  it('requires adjacency and equal point value', () => {
    // White knight (3) with an adjacent black bishop (3) and rook (5).
    const state = createStateFromFen('9/k8/9/9/3rb4/3N5/9/9/K8 w - - 0 1');
    const seconds = spellSecondaryTargets(state, 'white', 'sacrifice', sq('d4')).map(squareName);
    expect(seconds).toContain('e5'); // bishop, 3 = 3
    expect(seconds).not.toContain('d5'); // rook, 5 ≠ 3
    expect(tryCast(state, 'white', 'sacrifice', 'd4', 'd5')).toBeNull();
  });

  it('destroys both pieces without crediting captures', () => {
    const state = createStateFromFen('9/k8/9/9/4b4/3N5/9/9/K8 w - - 0 1');
    const after = cast(state, 'white', 'sacrifice', 'd4', 'e5');
    expect(pieceAt(after, 'd4')).toBeNull();
    expect(pieceAt(after, 'e5')).toBeNull();
    expect(after.captured.white).toEqual([]); // destruction, not capture
    expect(after.captured.black).toEqual([]);
    expect(after.reserves.white).toEqual(['knight']); // both are still lost pieces
    expect(after.reserves.black).toEqual(['bishop']);
    expect(after.history.at(-1)?.san).toBe('Sacrifice d4×e5');
  });

  it('never involves kings', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/1n7/9/KN7 w - - 0 1');
    // Own king adjacent to enemy knight: king is not a legal source.
    expect(spellPrimaryTargets(state, 'white', 'sacrifice').map(squareName)).not.toContain('a1');
    expect(tryCast(state, 'white', 'sacrifice', 'a1', 'b3')).toBeNull();
    // The enemy king is never a target: white knight b1 adjacent to… craft:
    const nearKing = createStateFromFen('9/9/9/9/9/9/9/1N7/k6K1 w - - 0 1');
    expect(spellSecondaryTargets(nearKing, 'white', 'sacrifice', sq('b2'))).toEqual([]);
  });

  it('does not trigger champion armour or jester transformation', () => {
    // Sacrificing into a full-armour champion (9 vs 9 via queen) destroys it outright.
    const champ = createStateFromFen('9/k8/9/9/4h4/3Q5/9/9/K8 w - - 0 1');
    const after = cast(champ, 'white', 'sacrifice', 'd4', 'e5');
    expect(pieceAt(after, 'e5')).toBeNull(); // armour never engaged
    expect(pieceAt(after, 'd4')).toBeNull();

    // A friendly jester destroyed does not transform anything.
    const jester = createStateFromFen('9/k8/9/9/4n4/3É5/9/9/K8 w - - 0 1');
    const gone = cast(jester, 'white', 'sacrifice', 'd4', 'e5');
    expect(pieceAt(gone, 'd4')).toBeNull();
    expect(gone.captured.white).toEqual([]);
  });

  it('avenger and jailer see nothing from destruction', () => {
    // White sacrifices its knight against black's bishop; black's avenger
    // inherits nothing because nothing was captured.
    const state = createStateFromFen('9/k6e1/9/9/4b4/3N5/9/9/K6Ï1 w - - 0 1');
    const after = cast(state, 'white', 'sacrifice', 'd4', 'e5');
    expect(targets(after, 'h8')).toEqual([]); // black avenger still inert
  });

  it('cannot leave its own king exposed', () => {
    // The white knight on e2 shields the king from the e8 rook; both it and
    // the black bishop on d3? craft: knight e2 (3), black bishop f3 (3,
    // adjacent). Removing both opens nothing? Use the knight as the shield ON
    // the e-file with the rook behind.
    const state = createStateFromFen('9/k3r4/9/9/9/9/5b3/4N4/4K4 w - - 0 1');
    expect(tryCast(state, 'white', 'sacrifice', 'e2', 'f3')).toBeNull();
  });

  it('a shielded enemy cannot be sacrificed away', () => {
    let state = createStateFromFen('9/k8/9/9/4b4/3N5/9/9/K8 b - - 0 1');
    state = cast(state, 'black', 'shield', 'e5');
    expect(spellSecondaryTargets(state, 'white', 'sacrifice', sq('d4'))).toEqual([]);
    expect(tryCast(state, 'white', 'sacrifice', 'd4', 'e5')).toBeNull();
  });
});

describe('turn integration', () => {
  it('a cast is a full turn: no move afterwards, opponent plays next', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const after = cast(state, 'white', 'shield', 'd1');
    expect(after.turn).toBe('black');
    // White cannot act; black can.
    expect(tryCast(after, 'white', 'freeze', 'a8')).toBeNull();
    expect(generateLegalMovesFrom(after, sq('a8')).length).toBeGreaterThan(0);
  });

  it('no spell casting during a duelist bonus window', () => {
    // White duelist moves; white owes a bonus move; casting is barred.
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2D5 w - - 0 1');
    const after = play(state, 'd1', 'd2');
    expect(after.phase).toBe('bonus');
    expect(after.turn).toBe('white');
    expect(tryCast(after, 'white', 'shield', 'd2')).toBeNull();
  });

  it('spells count toward the fifty-move clock except sacrifice', () => {
    const state = createStateFromFen('9/k8/9/9/4b4/3N5/9/9/K2R5 w - - 5 10');
    const shielded = cast(state, 'white', 'shield', 'd1');
    expect(shielded.halfmoveClock).toBe(6);
    const sacrificed = cast(state, 'white', 'sacrifice', 'd4', 'e5');
    expect(sacrificed.halfmoveClock).toBe(0);
  });
});
