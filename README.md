# Chess 2

Chess, but you build your own army. Two local players draft custom rosters from a point
budget, deploy them anywhere on their first two ranks, and play with full chess rules —
check, checkmate and king safety included.

**Batch 1A** ships the roster system with twelve Queen-class pieces:
Queen, Archbishop, Trapper, Revolutionary, Duelist, Chariot, Champion, Avenger, General,
Diplomat, Infiltrator and Warrior — each 9 points against a 33-point budget, plus the
mandatory free King.

**Batch 2** adds seven Rook-class pieces at 5 points each: Rook, Berserker (only moves
by capturing — friend or foe), Leper (Queen that cannot stop next to allies), Archer
(King steps, Queen-range shots, never point-blank), Battering Ram (exactly two squares,
crushing everything on its path), Catapult (rook slide, cannon capture over one screen),
and Jouster (a Queen that cannot stop until edge, ally, or first kill). Classes are
sections in one builder; every cost lives on its piece definition.

**Batch 3** adds seven Knight-class pieces at 3 points each: Knight, Squire (jumps to
squares beside any friendly piece, captures one square forward), Jester (permanently
becomes each piece it captures), Ambusher (guards its 8 surrounding squares and captures
enemies that just passed through them), Spy (sacrifices itself to become any other piece
type from its roster), Assassin (forward-only; reaching the enemy back row wins the game
outright), and Double (King-like; may swap squares with its own King — deferring
checkmate while the swap can save him).

**Batch 4** adds seven Bishop-class pieces at 3 points each: Bishop, Monk (a mutual
non-aggression pact with all Pawn-class pieces), Shieldmaiden (cannot be captured by
enemies that start in front of her), Jailer (Queen whose range equals the enemy Pawns
its owner has captured — it starts frozen), Kingsguard (Queen bound within 2 squares of
its King), Warhound (must capture whenever a legal capture exists), and Spearman
(Bishop that kills at range, halting one square short of its victim — adjacent enemies
are too close to stab).

**Batch 5** adds Spell Cards to custom-army matches: every player starts with one each
of Shield (a piece cannot be captured by any means until your next turn), Reveal (see
the opponent's remaining cards, permanently), Freeze (an enemy piece cannot act during
its owner's next turn), Teleport (move a friendly piece to any empty same-coloured
square) and Sacrifice (destroy one of your pieces and an adjacent enemy of equal point
value — destruction is not a capture, so no on-capture ability triggers). Casting a
card consumes the whole turn; each card is one-shot. Spells are a registry like pieces
(`spells.ts`), ongoing statuses are generic `ActiveEffect`s enforced inside the
engine's existing capture/immobility funnels, and hidden cards are only readable via
`visibleOpponentSpells`. A position built without card decks keeps spells off.

**Batch 6** grows the hand to 16 cards: seven new spells — Smoke Screen (3×3 fog for
two rounds; the opponent cannot see the pieces inside), Reconnaissance (glimpse two
random enemy cards, chosen deterministically from the position), Royal Order (your
normal move plus one bonus Pawn move), Last Stand (when outnumbered, a piece survives
its next capture), Interference (disable a revealed enemy trap), Null Field (3×3
spell-suppression zone) and Sacred Ground (the piece on a square is card-immune for a
round) — and the first four Trap Cards, placed face-down on empty squares: Tripwire
(halts a piece that travels across it and cancels its bonus moves), Sonar (scans 3×3
and reveals hidden enemy traps), Web Trap (the arriving piece loses its next chance to
move) and Dead Zone (once its trigger leaves, the square is impassable terrain for a
round, blocking slides like an occupied square). Shared subsystems carry them:
board regions, per-square statuses, the trap lifecycle (hidden → revealed → spent),
and traveled-path detection derived from the movement engine.

**Batch 7** makes cards part of army-building: each army picks its Spell and Trap
decks in new Builder tabs (PIECES | CARDS | OPERATOR-soon), saved with the
roster and carried into the match — during play each side only has the cards it
brought. A fifth trap, **Mine** (destroys the enemy piece that lands on it —
destruction, not capture; kings survive; king-safety fizzle like Tripwire),
completes the trap pool. Spells and traps are one category throughout the UI: a
single CARDS tab in the builder and, in the match, a hand at each edge of the board
(the engine still distinguishes traps mechanically — hidden placement, no Null Field
suppression).
(Originally exactly 5+5 free cards; superseded by shared-budget pricing below.)

**Shared-budget cards**: spells and traps are priced content drawn from the SAME
point pool as pieces — any allotment, one copy of each card at most, no minimums.
Costs live on the engine card definitions (`SpellDefinition.cost`) and were set
from the 25,000-game GreedyBot baseline (`balance-results/baseline-v1`): each
spell's price tracks its adjusted marginal win contribution (Shield/Last Stand
+2.6pp → 4 pts; Royal Order/Sacrifice → 3; near-neutral cards → 2; Freeze,
Teleport, Null Field, Recon → 1). Trap coefficients were unidentifiable in that
baseline (the fixed 5+5 loadout gave trap selection zero variance), so traps are
priced from behavioral telemetry: Mine and Web Trap (2 pts) fire most with
material/tempo impact; Tripwire, Sonar and Dead Zone (1 pt) rarely fire or only
gather information. Smoke Screen and Recon prices carry the limited-fidelity
caveat and are first in line for re-pricing. The budget rose **42 → 55** so the
classic 5+5-style loadout (~11–20 pts of cards) still leaves a traditional army.

**Batch 10** settles where the King stands and who it may castle with. The King now
holds its traditional seat — **e1 for White, e9 for Black** — and nothing else about
deployment changed: every other piece still goes anywhere in the two home ranks. The
throne is not a suggestion; the roster layer refuses to move the King off it, refuses
to let anything else take the square, and `validatePlacement` rejects an army (a saved
one from before the rule, or a tampered payload) that breaks it. `autoPlace` repairs
such an army instead of leaving it illegal, and the placement screen renders the
square as spoken for.

That fixed seat is what makes castling possible again, and because an army chooses its
own deployment, **the corner is not reserved for Rooks**: whatever friendly piece holds
a1 / i1 (a9 / i9) is the King's castling partner. Only its square matters, never its
type — a Catapult, a Champion or a Pawn will do. Rights are derived from the board at
setup (`castlingRightsFromBoard`): a wing is available when the King is on its throne
and *someone* holds that corner, so emptying a corner is a real cost. Everything else
is standard: nothing between, no castling out of, through, or into check, rights lost
the moment either square is touched — plus one Chess 2 rule, that a frozen or webbed
partner cannot be swung around the King.

**Batch 9** adds three new card classes, so a deck is no longer just spells and
traps. **Relics** are equipment worn by a piece until something spends it:
*Mirror Shield* (3) turns aside the first enemy card that targets its wearer —
that card is spent for nothing, and so is the relic — and *Crown of Command* (4)
buys its owner a bonus Pawn move the first time the crowned piece moves.
**Terrain** is construction, which belongs to the board and is not suppressed by
a Null Field: *Wall* (3) makes two adjacent empty squares impassable for two
rounds, and *Portal* (3) opens two gates a piece may step between, arriving
without crossing the ground in between (so nothing on the way — a Tripwire, an
Ambusher — can touch it). **Curses** sit on an enemy piece and resolve later:
*Decay* (4) crumbles its victim after three of its owner's turns (destroyed, not
captured; Kings and Queen-class pieces are too strong to rot) and *Transform* (5)
demotes a piece down the class ladder — Queen → Rook → Bishop/Knight → Pawn —
into any piece of a lower class **you** choose.

All five kinds run through the one card pipeline: `SpellDefinition.kind` is what
the builder groups by and what two rules read (Null Field suppresses magic but
not masonry; a set trap keeps its identity hidden). Transform is the first card
that asks its caster a question as well as a target, so `SpellCast` gained an
optional `choice` and definitions an optional `choices` list — the action layer
enumerates one action per legal answer, which is how the AI, the balance lab and
online replay all pick it up unchanged. The new prices are estimates, not
evidence: unlike the original cards they have not been through a baseline run.

**Batch 8** grows the arena: the board is now **9×9** (files a–i, ranks 1–9) and the
roster budget is **55 points** (originally 42; raised when cards joined the pool). Deployment zones are each side's first two ranks (1–2
and 8–9), pawns start on ranks 2/8 and promote on 9/1, castling uses the a/i-file
corners around the centred king on the e-file, and the standard position (used by the
perft suite and the FEN tests) fields a symmetric twin-queen lineup (RNBQKQBNR + nine
pawns). The perft suite now holds self-generated
regression anchors: the original 8×8 fixtures were externally validated before the
migration, and the same positions embedded into 9×9 lock the move generator against
change.

**Board art**: the 9×9 board asset lives at `public/board.png` and carries its own
frame, coordinate labels (a–i, 1–9) and checkered surface. `.board-frame` renders the
image; the interactive 9×9 grid is absolutely positioned on top of the painted
playfield using insets measured from the asset (playfield spans x 99→1158, y 73→1148
of 1254px), so the cells land exactly on the painted squares at any size. It ships as
a quality-94 JPEG (596 KB rather than the 2.4 MB source PNG — no transparency is
needed and the re-encode measures 41.6 dB PSNR, i.e. visually lossless). Squares are
transparent windows — every highlight, overlay and card effect still draws over them,
and the in-square coordinate labels were removed since the frame provides them.

**Piece cards**: the Pieces tab is a three-column layout — Your Army on the left,
the catalog in the middle, a vertically-centred card slot on the right. The screen
claims the viewport (`100dvh`): the header, tabs and summary keep their natural
height and the three columns share whatever band is left, each scrolling its own
list, so nothing is tied to a hard-coded height and the page never runs past the
fold. Column gutters and the card itself scale with the window
(`clamp()`, `fr`, `rem`), and when the window is short the card's portrait gives
way first so the rules and the Add/Remove footer stay reachable.
Hovering (or focusing) a catalog row
swaps the docked card; clicking a row also opens it as a full-screen overlay.
Both render the same `PieceCardFace`
([PieceCardOverlay.tsx](src/ui/components/PieceCardOverlay.tsx)). Pieces with
painted artwork show it (below); the rest get the drawn card — green-and-gold
frame, portrait, parchment rules panel, point medallion and flavour quote. Every
word is read live from the engine's `PieceDefinition`, so the card can never drift
from the rules; Add/Remove drive the real roster through `addUnit` /
`removeLastUnitOfType` and respect `canAfford` without closing the card. The
overlay closes with X, Escape or the backdrop, leaving the docked card in place.
Below 1100px the card drops beneath a two-column army/catalog grid; below 640px
everything stacks.

**Card art**: the official 14-card art kit lives in `public/card_art/` and is mapped
onto the card definitions via a single id → asset table in `spells.ts`
(`SpellDefinition.artwork`). The Army Builder deck tiles render the full card faces
(2:3, lazy-loaded), and so do the hands in the match (below). Royal Order, Tripwire
and Mine have no art yet and fall back to icon tiles. (The kit's `07_royal_order.png` is actually the Shield
card — it is mapped by its content, not its filename.)

**Card hands**: cards are held at the table, not listed in a panel. Each side gets a
hand along its edge of the board ([CardHand.tsx](src/ui/components/CardHand.tsx)):
yours face up and playable at the bottom, the opponent's face down across from you —
a count, never a list. Hovering one of your own cards raises and enlarges it and
prints its rules beneath the board; arming a card docks the targeting prompt to the
hand. Spent cards move to a small pile beside the hand: your own face up, the
opponent's face up only for spells they cast openly — a spent trap card stays face
down, because it may still be armed somewhere on the board. Nothing in the UI can
turn an enemy card over: face-up enemy cards come from `visibleOpponentSpells`
(i.e. Reveal), and hot-seat play simply swaps which hand is open as the turn passes.

**Card activation**: playing a card takes over the screen for a beat
([CardActivation.tsx](src/ui/components/CardActivation.tsx)) — the card slams in face
down, holds, then turns over in a burst of light with its name. A **trap** never turns
over when it is set: it stays face down, exactly as the opponent is entitled to see
it, and flips face up later, when it actually fires. The moments are derived from the
game state alone by comparing consecutive positions
([useCardActivations.ts](src/ui/useCardActivations.ts)): a new `cast` in the history,
or a trap that just became `revealed`. That is what keeps the animation from leaking
anything the position does not already say —
[cardActivations.test.ts](src/ui/__tests__/cardActivations.test.ts) pins it, including
that a set trap's id never reaches the UI. The layer is decorative: it takes no
pointer events, never blocks play, and collapses to a plain fade under
`prefers-reduced-motion`.

**Painted card art**: thirty-one of the thirty-four draftable pieces have a painted
full-card asset — ten Queen-class in `public/queen-class/` (emerald frames), seven
Rook-class in `public/rook-class/` (crimson), seven Knight-class in
`public/knight-class/` (sapphire) and seven Bishop-class in `public/bishop-class/`
(pale stone) — wired up by a single type → path table
([pieceCardArt.ts](src/ui/pieces/pieceCardArt.ts)). These images *are* the card —
frame, title, class band, point badge, rules panel and flavour line are all
painted in — so a piece with art renders the image in place of the drawn face, with
only the In army / Remove / Add row beneath it. The art is scaled with
`object-fit: contain` and never cropped or stretched: docked it shrinks to the
column, pinned it is capped at `82vh` so its controls stay inside the window, and it
falls back to the drawn card for the three pieces still without art: Trapper,
Warrior and the Pawn (Pawn-class, 1 point — every deployment square its own
piece, capped by the `too-many-units` roster rule since 42 points can now buy
more units than the two ranks hold). It is presentation only — the table lives in the UI layer, the engine has
no idea the files exist, and the alt text is built from the `PieceDefinition` so
assistive tech gets the authoritative rules rather than the printed ones. The
supplied 1024×1536 PNGs (91 MB) ship as quality-90 4:4:4 JPEGs (22 MB total, ≥36 dB
PSNR, lazy-loaded) — printed rules text is pixel-for-pixel legible.

Assets are named after the engine's piece id and, where a kit's filenames disagree
with what its images show, after the card actually depicted — mapped by reading each
image, not by trusting its name. Two kits needed it: the Rook kit's
`battering_ram.png` ships as `battering-ram.jpg` (id spelling), and five of the seven
Knight files were shuffled — its `ambusher.png` is the Jester card, `assassin.png` is
Spy, `double.png` is Ambusher, `jester.png` is Double and `spy.png` is Assassin. Only
`knight.png` and `squire.png` were already correct.
[pieceCardArt.test.ts](src/ui/__tests__/pieceCardArt.test.ts) checks every path
resolves to a shipped file, matches its piece id, and that no artwork leaked into
the engine's definitions.

The flow: `Main menu → Build army (White) → Place army → Build army (Black, or mirror
White) → Place army → Match`.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (default <http://localhost:5173>).

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the engine test suite (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run balance` | Headless self-play balance run (see below) |
| `npm run balance:benchmark` | Simulation throughput measurements |
| `npm run balance:replay` | Reproduce a recorded simulation failure |

## Playing

- **Click** a piece to select it, then click a highlighted square — or **drag** the piece
  onto its destination. Both work with mouse and touch.
- Dots mark quiet moves, rings mark captures, the selected square and the last move are
  tinted, and a king in check gets a red halo.
- Promotion opens a picker (queen / rook / bishop / knight).
- The sidebar shows whose turn it is, the game result when it ends, captured material,
  and the full move history in algebraic notation.
- **Time control** is chosen on the menu — Unlimited, 5, 10, 15, 30 minutes or 1 hour —
  and applies to both modes. Timed games show both clocks in the sidebar; the side to
  move is highlighted, the last 30 seconds turn amber, and running out ends the match
  ("Black wins — White ran out of time") and locks the board. White's clock starts when
  the match does, as in standard chess. Untimed games render no clock at all.

  The clock deliberately lives **outside the engine** (`ui/timeControls.ts` +
  `ui/useGameClock.ts`): `GameState` stays a pure function of the moves played, which is
  what lets the balance laboratory replay hundreds of thousands of games with no wall
  clock in sight. `useChessGame` takes an `isLocked()` getter so match-level endings the
  engine knows nothing about can freeze input. Time is measured from `Date.now()` deltas
  rather than counted ticks, so a throttled background tab still deducts real elapsed
  time instead of quietly gifting it.

## Architecture

The hard rule is that **no chess rule lives in a React component**. The engine is plain
TypeScript with no DOM or React dependency, and could be run in a worker, on a server, or
inside an AI search loop unchanged.

```
src/
  engine/                 ← pure rules, no UI
    types.ts              GameState, Move, Piece … all plain serializable data
    board.ts              square indexing / coordinate helpers
    pieces.ts             piece definition registry  ← the Chess 2 extension point
    customPieces.ts       the twelve Queen-class definitions (pure data)
    rookPieces.ts         the seven Rook-class definitions (pure data)
    knightPieces.ts       the seven Knight-class definitions (pure data)
    bishopPieces.ts       the seven Bishop-class definitions (pure data)
    captureRules.ts       capture permissions (class immunities, forward shields, Shield spell)
    effects.ts            timed piece statuses (Shield, Freeze, Webbed) and expiry
    spells.ts             spell/trap card registry, targeting, casting
    boardEffects.ts       regions, square statuses, trap placements, detection
    traps.ts              tripwire interception, landing triggers, dead-zone lifecycle
    abilities.ts          ability descriptors + the map of which module owns each
    auras.ts              board-wide passive effects (grants, immobilization)
    specialMoves.ts       castling, en passant, double push, promotion hooks
    patterns.ts           the single pattern walker every piece moves through
    attacks.ts            "is this square attacked?"
    moveGeneration.ts     pseudo-legal → legal moves (+ ability move variants)
    apply.ts              board-level move application (+ board-level effects)
    game.ts               state transitions, turn phases, status, draws
    notation.ts           SAN for the move history
    fen.ts                FEN in/out (serialization + repetition key)
    perft.ts              move-generator verification harness
  roster/                 ← armies, budgets, deployment (engine-independent of UI)
    types.ts              Roster, RosterUnit, RosterError
    catalog.ts            what's draftable, budgets, class labels — all derived
    roster.ts             pure roster ops: add/remove/place/auto-place/mirror
    validation.ts         composition + placement validation (engine-side)
    setup.ts              rosters → GameState (the only bridge to the engine)
  ui/
    useAppFlow.ts         menu → build → place → game state machine
    useChessGame.ts       interaction state (selection, pending move choice)
    screens/              MainMenu, TeamBuilder, PlacementScreen, GameScreen
    components/           Board, StatusPanel, MoveHistory, MoveChoiceDialog, …
    pieces/               SVG artwork, keyed by piece type
  App.tsx                 screen routing only
```

### How the engine works

1. **Pieces are data.** A `PieceDefinition` describes movement as a list of
   `MovementPattern`s — direction vectors plus flags (`sliding`, `range`, `capture`,
   `quiet`, `directional`). A rook is `{ vectors: ORTHOGONAL, sliding: true }`.
2. **One walker.** `walkPattern` turns those vectors into destination squares. Every
   piece — standard or custom — moves through this one function.
3. **Hooks for the rest.** Anything patterns cannot express is a function on the
   definition: `generateSpecial` (castling, en passant, double push) and `transformMoves`
   (expanding a pawn's last-rank move into four promotions).
4. **Legality is one rule.** Generate pseudo-legal moves, play each on a scratch board,
   and discard any that leave a *royal* piece attacked. Pins, discovered check, double
   check and en-passant discoveries all fall out of that single check — there is no
   special case for any of them.
5. **State is immutable.** `applyMove(state, move)` returns a new `GameState`. Nothing
   mutates, nothing is random, and `JSON.parse(JSON.stringify(state))` round-trips.

### Chess 2 systems on top

- **Abilities are data** (`abilities.ts`): a piece definition carries descriptors like
  `{ kind: 'hit-points', value: 2 }` or `{ kind: 'grant-patterns', scope: 'all-allies' }`.
  Each kind is interpreted in exactly one module — auras in `auras.ts`, move variants in
  `moveGeneration.ts`, board effects in `apply.ts`, turn phases in `game.ts`. The engine
  never names a specific piece.
- **Auras** are computed per position, cached per board, and skipped entirely when no
  ability piece is on the board — a plain chess position pays nothing for the system.
- **Turn phases**: a turn is `main`, optionally followed by `bonus` (the Duelist's free
  move) which only bonus-granting pieces may use; checkmate is never delayed by it.
- **Move variants**: one square-to-square gesture can map to several distinct moves
  (promotion piece, Revolutionary's defect, Chariot's pawn return). The engine returns
  them all; the UI shows a chooser.
- **Reserves**: every captured piece is recorded in its owner's reserve pool — that is
  what the Chariot draws from, and what future return/graveyard mechanics will use.

### Validation

`npm test` runs 350 tests:

- **Perft** against six standard reference positions (initial position to depth 4 =
  197,281 nodes, kiwipete, promotion-heavy and bug-catcher positions). Matching perft
  counts is the standard proof that castling, en passant, promotion, pins, discovered
  check and double check are all exactly right.
- **Rule tests** for each piece's movement, check/checkmate/stalemate, castling rights and
  restrictions, en passant (including the pinned case), promotion, the fifty-move rule,
  threefold repetition, insufficient material, SAN disambiguation and FEN round-tripping.
- **Spell tests**: the one-shot card lifecycle, turn consumption, hidden/revealed
  books, every card's targeting and resolution, effect expiry at exact boundaries, and
  interactions (Shield vs catapult/spearman/ram/jouster/warhound/en-passant, Freeze vs
  warhound and teleport, Sacrifice vs champion armour/jester/avenger/jailer).
- **Bishop-class tests** for all seven pieces: class immunities in both directions,
  front-shield geometry for both colours, state-derived Jailer range, King-radius
  binding, capture compulsion (and what does not compel: pins, shields, armour), and
  stab-capture destinations, plus cross-class interactions.
- **Knight-class tests** for all seven pieces: army-jumps, transformation chains,
  ambush windows (including a leaping Diplomat being caught mid-flight), in-place spy
  conversion, the assassin's instant win, and royal swaps rescuing a mated king.
- **Rook-class tests** for all seven pieces: forced runs, hop captures, path crushing,
  minimum-range shooting, friendly-fire accounting, and cross-class interactions
  (Berserker vs Champion armour, Ram feeding the Chariot's reserve).
- **Custom piece tests** for all eleven Queen-class pieces: movement plus each unique ability,
  including edge cases (a Trapper suppressing check, a pinned Duelist's free move, kings
  forbidden from attacking a surviving Champion, Diplomat conversions sparing kings).
- **Roster tests**: budget enforcement, duplicates, king requirement, two-row placement,
  collisions, out-of-zone and opponent-zone rejection, mirroring, and starting/playing a
  real game from a custom deployment.

During development the engine was additionally cross-checked move-for-move against an
independent reference engine over 60 random games (~9,600 plies) — legal move sets, FEN,
SAN and terminal states all matched. That dependency was removed afterwards; the suite is
self-contained.

## Extending it for Chess 2

Adding a custom piece should not touch the engine. It is:

```ts
registerPiece({
  type: 'chancellor',
  name: 'Chancellor',
  symbol: 'c',
  value: 8,
  patterns: [
    { vectors: ORTHOGONAL, sliding: true },   // rook
    { vectors: KNIGHT_LEAPS },                // knight
  ],
});
```

…plus an entry in `PIECE_GRAPHICS` for its artwork (the UI falls back to the piece's
letter until then). Move generation, check detection, checkmate, SAN and FEN all pick it
up automatically.

Ready-made seams for later phases:

| Phase 2 need | Where it plugs in |
| --- | --- |
| Custom pieces | `registerPiece()` in `engine/pieces.ts` |
| Special abilities | `generateSpecial` / `transformMoves` hooks on a definition |
| Roster cost / drafting | `value` on the definition; extend with cost fields |
| Alternate starting armies | `createStandardBoard()` + `STANDARD_BACK_RANK` are data |
| Save / load / replay | `toFen()` / `createStateFromFen()`; every history entry stores the FEN before its move |
| Multiplayer | `Move` objects are self-contained and serializable |
| AI opponents | `generateLegalMoves()` + `advance()` are the search API; `perft.ts` shows the pattern |
| Board sizes / variant rules | Board geometry is derived from `FILE_COUNT`/`RANK_COUNT`; castling geometry is data in `castling.ts` |

## Balance laboratory

A headless AI/self-play system for answering balance questions at scale: is a
piece worth its points, which armies dominate, are cards too strong, how big is
the first-move advantage. It is built ON the engine, never beside it — every
move comes from `generateLegalMoves`/`applyMove`, every cast from `castSpell`,
every army from the roster module, every piece and card from the live
registries. Register a new piece or card and the laboratory discovers it with
no balance-side changes (a test proves this with a dummy piece).

```bash
npm run balance -- --games 25000 --bot greedy --workers 8 --mirror --seed 42
```

The same seed and options reproduce the same games, ratings and report at ANY
worker count — pairings derive everything (armies, agents, match seed, record
identity) from `(masterSeed, pairingIndex)` alone, and ratings are computed in
one canonical post-pass, so worker scheduling cannot influence a result. The
in-process `--workers 1` path remains the reference implementation, and a
partition-equivalence test pins the guarantee.

Options: `--games`, `--seed`, `--bot random|greedy|alphabeta`, `--depth`,
`--max-turns`, `--mirror/--no-mirror`, `--workers N` (default: conservative,
never every core), `--armies N`,
`--army-mode random|classes|class:<name>|piece:<type>`, `--min-games`,
`--output`, `--name <run-dir-name>`, `--fail-fast`, and `--override
piece=cost[,piece=cost…]` for A/B cost experiments. Overrides re-register
copies inside each worker's own JS realm (workers cannot contaminate each
other or the baseline) and are always restored; the real definitions are
never modified. Because cost is gameplay-relevant, an overridden run carries a
different **content fingerprint** — see below — and armies are re-generated
legally under the experimental costs from the same army seed (a price rise
can legitimately shrink how many copies fit the 42-point budget; the
comparison reports this rather than hiding it).

Layers (`src/ai`, `src/sim`, `src/balance`, `src/cli`):

- **Actions** (`ai/actions.ts`): one `GameAction` union — piece move, spell,
  trap, bonus-phase pass — generated and applied purely through engine calls.
  `getObservationForPlayer` is the information boundary: agents never see
  unrevealed enemy traps or hands, so search cannot cheat.
- **Agents**: `RandomBot` (fuzzing + rating floor), `GreedyBot` (one-ply over a
  cost-anchored evaluation with configurable weights), `AlphaBetaBot`
  (iterative deepening, transposition table over a full gameplay hash, move
  ordering, node budgets — searching only its observation).
- **Simulation** (`sim/`): seeded RNG (no `Math.random` anywhere), headless
  `runMatch` with ply cap and structured failure capture, `runTournament` with
  mirrored pairs on paired seeds (that pairing is what separates army strength
  from first-move advantage), per-match telemetry (captures, survival, card
  usage, trap lifecycles).
- **Analysis** (`balance/`): army generators (random / class-heavy /
  piece-heavy / mutation) validated by the roster module; separate Elo ladders
  for agents and armies keyed by composition fingerprints; descriptive stats
  with Wilson intervals; an L2-regularized logistic model whose intercept
  absorbs first-move advantage, whose per-piece coefficients yield
  value-per-point estimates, and whose Hessian-based standard errors put a
  95% interval on every adjusted effect; synergy deltas (actual vs
  model-expected score for pairs, with intervals); conservative point-cost
  *investigation* suggestions — the system never changes a cost itself.

**Evidence tiers.** Findings are classified WATCH → INVESTIGATE → BALANCE
CANDIDATE by configurable thresholds (sample size, distinct armies, adjusted
effect size, interval clear of neutral). BALANCE CANDIDATE additionally
requires cross-bot replication — a second bot's model agreeing in direction —
because a signal only one bot sees usually exploits that bot's weaknesses.
Every piece reports BOTH raw and adjusted statistics; raw win rate alone can
never generate a recommendation (a passenger piece inherits its army-mates'
raw rate — a synthetic test proves the adjusted model does not fall for
this). "No piece clears the evidence bar" is the expected output at small
samples, and it is a feature.

**Content fingerprint.** Every run records a deterministic hash of the
gameplay rules in force — costs, classes, patterns, abilities and the source
text of behaviour hooks; never artwork, prose or icons. Two reports are
comparable only when their fingerprints match; `balance:compare` warns loudly
when they differ, and recognizes the benign case where the difference is
exactly the declared overrides.

**Modelling fidelity.** Recon (castability reads the hidden enemy hand) and
Smoke Screen (search retains obscured occupancy for legality/check) are
modelled at LIMITED fidelity; every report says so, and findings that lean on
limited-fidelity mechanics are capped at WATCH. The intended future fix is
information-set search (ISMCTS): agents sampling hidden states consistent
with their observation instead of reading anything.

Other commands:

```bash
npm run balance:fuzz -- --games 50000 --workers 8      # RandomBot stress campaign
npm run balance:compare -- --baseline <dir> --experiment <dir>
npm run balance:replay -- --run <dir> --pairing <n>
npm run balance:benchmark                              # incl. worker scaling
```

Fuzz campaigns aggregate streaming (no match list in memory), label
themselves "engine stress test — NOT balance evidence", report termination
histograms, max-turn-cap hits and per-content coverage, and flag registered
content the campaign barely exercised. `balance:compare` diffs two runs —
first-move, game length, class efficiency, per-piece inclusion/contribution,
card pick and trigger rates, synergy movement, replacement outliers — and
switches to a cross-bot direction-agreement report when the two runs used
different bots.

Each run writes `balance-results/<name>/` with `config.json` (including the
fingerprint, cost table and worker count), `report.json` (the full structured
report, machine-readable for compare), `summary.json`, `matches.jsonl`,
piece/card/class/synergy/matchup CSVs, `point-recommendations.json`, and
`failures/` (each failure holds the seed, FEN, action log and full rosters;
`balance:replay` reproduces it, applying the run's overrides).

Throughput (M-series): ~6 games/s random and ~2.6 games/s greedy per worker;
worker scaling measured by `balance:benchmark` (≈3× at 8 workers on short
runs, better amortized on long ones). Deliberately not built yet:
evolutionary army search (the `optimizedArmyInclusionRate` field is already
in the data model, null until then), Glicko-2, ISMCTS.

## Accounts & cloud sync (Supabase)

Optional, local-first: the game, the engine and the balance laboratory run fully
without a network or an account. With a Supabase project configured, players can
create accounts (email + password), and every finished game is saved to their
match history — mode, time control, result and reason (including "on time"),
the SAN move list plus starting FEN (enough for the engine to replay the game),
the final position, and for custom matches both full army rosters and the
content fingerprint of the rules the game was played under.

Setup:

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the dashboard's SQL
   editor. It creates `profiles`, `saved_armies` and `matches`, all row-level
   secured so an account can only ever touch its own rows, plus a trigger that
   gives every new user a profile.
3. Create `.env.local` at the repo root (gitignored):

   ```text
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable anon key>
   ```

4. Restart the dev server. The menu's Account panel switches from a setup hint
   to sign-in / create-account.
5. Run [`supabase/online.sql`](supabase/online.sql),
   [`supabase/online-custom.sql`](supabase/online-custom.sql) and
   [`supabase/online-clock.sql`](supabase/online-clock.sql) — **in that order** —
   for online play, drafting and the match clock. Each builds on the one before,
   and a project missing any of them answers "could not find the function … in
   the schema cache" the moment someone searches for a game.
6. Run [`supabase/admin.sql`](supabase/admin.sql) **last** for admin accounts and
   the content config (below). Last because it redefines `submit_online_army` to
   add the secret-card gate, so re-run it whenever you re-run one of the online
   files.
7. Optional: [`supabase/accounts.sql`](supabase/accounts.sql) adds the admin-only
   player directory.

**Credentials are Supabase Auth's, not the app's.** `auth.users` holds the email
and the bcrypt hash; nothing in the `public` schema mirrors the secret half, and
nothing should. Every table and function in `public` is served to the internet by
PostgREST using the key that ships in the browser bundle, so a password column
there — plaintext or hashed — is one policy mistake away from a dump, and buys
the app nothing: `signInWithPassword` verifies server-side and the client never
holds the password after the form. What an admin actually needs is the identity
half, and `list_accounts()` returns exactly that (name, address, joined, last
seen, admin flag) to admins and an empty set to everyone else. Reset a password
from the dashboard's Authentication → Users page.

### The online clock

Time controls belong to online play: the picker lives in the online lobby,
because a clock is a rule two strangers agree to before a game — two players
sharing a screen also share a wall clock, so a local hot-seat match is untimed.
Players are paired on the control they picked.

The clock is kept **by the server** ([online-clock.sql](supabase/online-clock.sql)),
for the same reason the drafting deadline is: a paused tab, a throttled timer
or a tampered client must never buy a player extra time. Each side's remaining
milliseconds live on the game row and are charged from `now() - turn_started_at`
every time an action is appended; White's clock starts the moment both armies
are in. A bonus phase that keeps the same player on turn keeps charging them,
which is correct. An action that arrives after its sender's flag has fallen is
**not recorded** — the game is finished on time instead (reported as `-1`
rather than by raising, which would roll the finish back with it).

Losing on time is therefore never a client's verdict. Either player may ask
(`claim_online_timeout`) and the server recomputes the elapsed time itself, so
an early or forged claim simply answers "active" and both clients can safely
race to call it. On the client the countdown is a pure projection of the row
([onlineClock.ts](src/cloud/onlineClock.ts), unit-tested), rendered by the same
`ClockPanel` local games used to use; `useOnlineClock` only redraws it and asks
for the flag. Because the row's stamps are the server's, the hook measures its
own device's offset once through `server_time()` — a laptop with a wrong system
clock still shows the true countdown.

### Admins & the content config

`supabase/admin.sql` adds two tables. `admins` is who may change the game's
content; it has a select policy for your own row and **no** insert/update/delete
policy at all, so a grant can only be made from the SQL editor (service role) —
a player cannot promote themselves by writing to a row they own. The script
grants `wagtrack@gmail.com` at the bottom; change the address there to promote
anyone else (the account has to exist first).

`content_flags` is the published catalog config: one row per piece or card the
admin has an opinion about, **public to read** (every client must see the same
catalog, signed in or not) and writable only when `public.is_admin()` passes. A
missing row means "available", so the table only ever stores deviations and an
empty table means the game is exactly as it ships.

An admin account gets an **Admin dashboard** button in the account popover
([AdminDashboard.tsx](src/ui/screens/AdminDashboard.tsx)): every piece and card
with an on/off switch. Each toggle is applied locally first and then written;
a refused write (which is what anyone without a grant gets, whatever the client
believes) rolls back and shows the server's reason.

On the client the config lives in the roster layer
([availability.ts](src/roster/availability.ts)) — a framework-free store the
catalog consults, mirrored into React through `useSyncExternalStore`
([useContentFlags.ts](src/ui/useContentFlags.ts)). `draftablePieces()`,
`availableSpellCards()` and `availableTrapCards()` return only what is switched
on, and `validateAvailability` flags an army carrying content that has since
been withdrawn (mirrored, or built earlier), which blocks the builder's confirm.

It is availability, not a rule: **nothing in `src/engine` imports it**. A game
already under way, a match being replayed from history and the balance
laboratory are all unaffected by a piece being switched off — which is also why
availability is validated separately from `validateComposition`, so an army
saved before the change is still structurally legal everywhere else. A build
without Supabase, or a failed request, leaves the full shipped catalog in place:
a network problem must never take content away mid-draft.

Architecture (`src/cloud/`): `supabaseClient.ts` reads the env and degrades to
null when unconfigured — every caller handles that, which is what keeps the app
fully playable offline; `records.ts` holds the pure GameState→row builders
(unit-tested, no network); `auth.ts`/`storage.ts`/`content.ts` return
`{ error }` results instead of throwing; `useAccount.ts` exposes the session —
and whether it is an admin — to React. Nothing in
`src/engine` or `src/balance` imports any of it. Match saves are fire-and-forget
on game end — a failed sync logs a warning and never touches gameplay.

**And one secret card.** *Ruler's Authority* (0 pts) annihilates every piece on
the board but the caster's King — and every trap, ward, wall and gate with them.
It is a joke card and deliberately a broken one: the turn it is played is the
turn the game ends. It carries `secret: true`, so the Army Builder only offers it
under a 🔒 heading to an admin account, and it is not dealt into the standard
card set — it can only reach a game through a drafted army. Playing it does not
flip a card: it fires a railgun
([RailgunStrike.tsx](src/ui/components/RailgunStrike.tsx)) — the board's light is
dragged into the muzzle, the screen whites out, a lance crosses the world with
chromatic fringes and shockwaves, and the decree lands. Four seconds of CSS
keyframes over a dozen divs; no assets, and a plain flash under
`prefers-reduced-motion`.

Because a King can now leave the board, `GameStatus` gained `annihilation`: a
side with no royal piece has lost, whatever the rest of the position says.
Ordinary chess can never reach that; a card can.

**The secret is hidden on the client and enforced on the server.**
`availability.ts` holds a `secretsUnlocked` flag set from the signed-in account's
admin grant, which keeps the card out of the catalog, out of `toggleSpellCard`
and out of a valid roster. That is a courtesy, not a boundary — a modified client
could still build one. What actually stops it in an ONLINE game is
`submit_online_army` in [admin.sql](supabase/admin.sql), which refuses a roster
containing a secret card from anyone without a grant. A local hot-seat game has
no server in the loop and so cannot be gated at all.

### How the new classes plug in

Nothing about them is special-cased outside their own definitions:

- **Relics and curses are `ActiveEffect`s** with no expiry — `expiresAtTurnStartOf: null`
  means "until something spends it", so `tickEffects` leaves them alone and
  `pruneEffects` still drops them when the piece dies. Each is enforced in exactly
  one funnel: Mirror Shield in `castSpell`, the Crown in `applyMove` (it arms the
  same bonus window a Royal Order does), Decay in `beginTurn`.
- **`beginTurn`** is the shared turn-boundary helper both `advance` and `castSpell`
  call: effects age, and a Decay whose victim is the side now to move counts down.
  A piece that crumbles joins its owner's reserves — destruction, not capture, so
  nothing is credited and no on-capture ability fires.
- **Walls are square statuses** (`blockedSquares` already made terrain impassable);
  **portals are their own field** on `GameState` because, unlike every other board
  effect, terrain that was built stays built and so carries no ply counter. A piece
  standing on a gate gets one extra `teleport` move in the generator.
- **A deflected card is still a spent turn** — and because it changes nothing, it
  can never be used to answer a check. `castWouldBeDeflected` exists so the action
  layer's legality probe models the same rule; the two disagreeing is precisely the
  bug the random-play fuzz caught.

## Known limitations

- Local hot-seat games are untimed and have no undo, no saved games and no AI — all
  deliberately out of scope so far. The clock is an online feature (above).
- Both players draft on one screen in sequence, so White can see Black's roster being
  built (and vice versa). Hidden drafting needs the future online/multi-screen layer.
- Castling in a custom army needs a piece left in a corner: the rights are read off
  the deployment, so an army that empties both corners simply cannot castle.
- Threefold repetition keys include hit-point, free-move and ambush-window state, but
  the Warrior's "moved last turn" flag is not part of the repetition key.
- The ambush window tracks only the last movement of a turn: if a player moves and then
  plays a Duelist bonus move, only the bonus move's path can be ambushed.
- "Passing through" is geometric: any straight-line move exposes its intermediate
  squares (sliders, double pushes, Diplomat and Ram leaps); L-shaped leaps and
  teleports (Squire jump, Royal Swap) expose nothing.
- Draws by threefold repetition and the fifty-move rule are applied automatically rather
  than being claimable, and there is no draw-offer flow (online games can resign).
- Insufficient-material detection covers the standard cases (K vs K, K+minor vs K, and
  same-coloured bishops); with an unrecognised custom piece on the board it conservatively
  reports "sufficient".
- `GameState.positionCounts` grows with the game — fine for a single game, worth revisiting
  if long-lived states are ever kept in memory in bulk.
- Piece artwork is deliberately simple placeholder SVG, isolated in `ui/pieces/` so a
  Chess 2 art pass replaces it in one file.
- The relic, curse and terrain cards are priced by judgement rather than by a
  balance run, and none of them has card-face art yet.
- A Transform can create a piece neither army drafted, and the resulting type is
  not checked against the admin content config — availability gates drafting, not
  what a card may conjure mid-game.
- The secret card's client-side hiding is a courtesy; only online army submission
  is enforced server-side (see above). It is also unpriced by design: at 0 points
  it is a joke, not a balance decision, and the balance laboratory does not draft
  secret cards.
