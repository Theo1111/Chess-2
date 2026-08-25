import type { PieceType } from '../../engine';

/**
 * Painted full-card artwork, keyed by piece type.
 *
 * These assets *are* the card: frame, title, class band, point badge, rules
 * panel and flavour line are all painted in, so a piece listed here renders its
 * image in place of the HTML card face rather than inside it.
 *
 * Presentation only. The engine's `PieceDefinition` remains the source of truth
 * for every rule and cost — nothing is ever read back out of these images — and
 * a piece with no entry simply falls back to the drawn card.
 */
export const PIECE_CARD_ART: Readonly<Record<string, string>> = {
  archbishop: '/queen-class/archbishop.jpg',
  avenger: '/queen-class/avenger.jpg',
  champion: '/queen-class/champion.jpg',
  chariot: '/queen-class/chariot.jpg',
  diplomat: '/queen-class/diplomat.jpg',
  duelist: '/queen-class/duelist.jpg',
  general: '/queen-class/general.jpg',
  infiltrator: '/queen-class/infiltrator.jpg',
  queen: '/queen-class/queen.jpg',
  revolutionary: '/queen-class/revolutionary.jpg',

  archer: '/rook-class/archer.jpg',
  // The kit ships this one as `battering_ram`; the asset is named after the
  // engine's id instead, so the table stays a straight type → file mapping.
  'battering-ram': '/rook-class/battering-ram.jpg',
  berserker: '/rook-class/berserker.jpg',
  catapult: '/rook-class/catapult.jpg',
  jouster: '/rook-class/jouster.jpg',
  leper: '/rook-class/leper.jpg',
  rook: '/rook-class/rook.jpg',

  // The Knight kit's filenames were shuffled (its `ambusher.png` is the Jester
  // card, and so on); every asset here is named after the card its artwork and
  // printed title actually show.
  ambusher: '/knight-class/ambusher.jpg',
  assassin: '/knight-class/assassin.jpg',
  double: '/knight-class/double.jpg',
  jester: '/knight-class/jester.jpg',
  knight: '/knight-class/knight.jpg',
  spy: '/knight-class/spy.jpg',
  squire: '/knight-class/squire.jpg',

  bishop: '/bishop-class/bishop.jpg',
  jailer: '/bishop-class/jailer.jpg',
  kingsguard: '/bishop-class/kingsguard.jpg',
  monk: '/bishop-class/monk.jpg',
  shieldmaiden: '/bishop-class/shieldmaiden.jpg',
  spearman: '/bishop-class/spearman.jpg',
  warhound: '/bishop-class/warhound.jpg',

  // Shipped as PNG, unlike its 31 siblings: the kit supplied it that way and
  // the art is not ours to re-encode.
  pawn: '/pawn-class/pawn.png',
};

export function pieceCardArt(type: PieceType): string | undefined {
  return PIECE_CARD_ART[type];
}
