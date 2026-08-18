import type { ReactNode } from 'react';
import type { PieceType } from '../../engine';

/**
 * Piece artwork, kept in one place and keyed by piece type.
 *
 * Everything is a plain SVG path in a 45×45 box using `currentColor`, so a
 * Chess 2 art pass — or artwork for a brand-new custom piece — means adding an
 * entry here, with no changes anywhere else in the UI.
 */
export type PieceGraphic = ReactNode;

const pawn: PieceGraphic = (
  <>
    <circle cx="22.5" cy="12.5" r="5.2" />
    <path d="M22.5 18c-4.1 0-6.8 2.6-6.8 5.7 0 2.2 1.2 3.5 2.2 4.3-2.6 2-5 5.6-5.6 10.5h20.4c-.6-4.9-3-8.5-5.6-10.5 1-.8 2.2-2.1 2.2-4.3 0-3.1-2.7-5.7-6.8-5.7z" />
    <rect x="10.5" y="37.5" width="24" height="4" rx="2" />
  </>
);

const rook: PieceGraphic = (
  <>
    <path d="M11 11h5v3h4v-3h5v3h4v-3h5v8l-3 3v10l3 3v4H11v-4l3-3V22l-3-3z" />
    <rect x="9" y="37.5" width="27" height="4" rx="2" />
  </>
);

const knight: PieceGraphic = (
  <>
    <path d="M13.5 37c0-5 1.4-8.6 3.6-11.6l1.1-4-1.5-.6-2.9 3.6-2.7-1.1 1.1-3.9c1.1-3.8 3.8-6.9 7.1-8.5l3.7-1.4.9-3.1c2.4 0 5.1 1.1 6.9 2.9 2.8 2.8 3.3 6.9.9 10.2C35.4 24 37 29.6 37 37z" />
    <circle cx="17.6" cy="16.4" r="1.3" fill="#000" opacity="0.55" />
    <rect x="10.5" y="37" width="26" height="4.5" rx="2.2" />
  </>
);

const bishop: PieceGraphic = (
  <>
    <circle cx="22.5" cy="8.5" r="2.8" />
    <path d="M22.5 11.5c-4.2 0-7.4 4.8-7.4 9.4 0 3.5 1.9 5.9 3.7 7.4h7.4c1.8-1.5 3.7-3.9 3.7-7.4 0-4.6-3.2-9.4-7.4-9.4z" />
    <path d="M14.5 29.5h16c.9 2.3 2.1 3.9 3.5 5.3H11c1.4-1.4 2.6-3 3.5-5.3z" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const queen: PieceGraphic = (
  <>
    <circle cx="7.5" cy="13.5" r="2.6" />
    <circle cx="15" cy="9.8" r="2.6" />
    <circle cx="22.5" cy="8.2" r="3" />
    <circle cx="30" cy="9.8" r="2.6" />
    <circle cx="37.5" cy="13.5" r="2.6" />
    <path d="M7.5 14.5 13.5 28h18l6-13.5-5.4 4.8-3.1-9.6-3.5 11.3-3-11.8-3 11.8-3.5-11.3-3.1 9.6z" />
    <path d="M13 29.5h19c1 2.3 2.1 3.9 3.5 5.3H9.5c1.4-1.4 2.5-3 3.5-5.3z" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const king: PieceGraphic = (
  <>
    <path d="M20.8 3.5h3.4v4h4v3.4h-4v4h-3.4v-4h-4V7.5h4z" />
    <path d="M22.5 15.5c-6.3 0-11 4.2-11 8.5 0 2.6 1.5 4.4 2.7 5.5h16.6c1.2-1.1 2.7-2.9 2.7-5.5 0-4.3-4.7-8.5-11-8.5z" />
    <path d="M13 30.5h19c1 2.3 2.1 3.6 3.5 4.8H9.5c1.4-1.2 2.5-2.5 3.5-4.8z" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

/* ------------------------------------------------------------------ */
/* Chess 2 Queen-class pieces. Placeholder sculpts: distinct sil-      */
/* houettes on the standard 45×45 grid, sharing the base/pedestal      */
/* language of the classic set so the armies read as one game.         */
/* ------------------------------------------------------------------ */

const BASE = <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />;

const archbishop: PieceGraphic = (
  <>
    {/* tall mitre with a cut jewel */}
    <path d="M22.5 3.5l5.5 9.5-5.5 3.5-5.5-3.5z" />
    <path d="M22.5 17c-4.6 0-7.8 5-7.8 9.6 0 3.2 1.7 5.4 3.4 6.9h8.8c1.7-1.5 3.4-3.7 3.4-6.9 0-4.6-3.2-9.6-7.8-9.6z" />
    {/* radiating diagonal marks */}
    <path d="M9.5 24.5l4-4M35.5 24.5l-4-4M11 32l3-3M34 32l-3-3" fill="none" strokeWidth="1.8" />
    <path d="M14.5 34.5h16c.9 1.6 1.9 2.6 3 3.6H11.5c1.1-1 2.1-2 3-3.6z" />
    {BASE}
  </>
);

const trapper: PieceGraphic = (
  <>
    {/* hooded head */}
    <path d="M22.5 6.5c-3.6 0-6 2.9-6 6.4v3.6h12v-3.6c0-3.5-2.4-6.4-6-6.4z" />
    <path d="M17.5 17.5h10l2.5 12h-15z" />
    {/* jaw teeth around the base */}
    <path d="M8 33l3.4-4 3.4 4zM17.4 33l3.4-4 3.4 4zM26.8 33l3.4-4 3.4 4z" />
    <path d="M8 35.5h29" fill="none" strokeWidth="2.4" />
    {BASE}
  </>
);

const revolutionary: PieceGraphic = (
  <>
    {/* knight-ish helm leaning forward */}
    <path d="M15 21c0-6 4-11.5 10.5-12.5l2.5-.5 1 3.3 3.5 1.7-2 3.5c1.6 3 2.5 7.5 2.5 12.5v6.5h-14z" />
    <circle cx="25.8" cy="13.8" r="1.2" fill="#000" opacity="0.55" />
    {/* torn banner flowing back */}
    <path d="M14.5 12.5l-6 1.5 5 2.5-4.5 3 6.5 1z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    {BASE}
  </>
);

const duelist: PieceGraphic = (
  <>
    {/* afterimage */}
    <g opacity="0.32">
      <circle cx="15.5" cy="10.5" r="3.2" />
      <path d="M15.5 15c-2.9 0-4.9 2.2-4.9 5.2v11.3h9.8V20.2c0-3-2-5.2-4.9-5.2z" />
    </g>
    {/* slim fencer */}
    <circle cx="24.5" cy="9.5" r="3.4" />
    <path d="M24.5 14.2c-3.1 0-5.2 2.3-5.2 5.5v11.8h10.4V19.7c0-3.2-2.1-5.5-5.2-5.5z" />
    {/* rapier */}
    <path d="M31 14l6.5 17.5" fill="none" strokeWidth="2" />
    <path d="M29 18.5l5.5-1.5" fill="none" strokeWidth="1.8" />
    {BASE}
  </>
);

const chariot: PieceGraphic = (
  <>
    {/* armored cab with crenellation, low and wide */}
    <path d="M10 18h6v2.8h4V18h5v2.8h4V18h6v8l-2.5 2.5v4H12.5v-4L10 26z" />
    {/* wheels */}
    <circle cx="15.5" cy="33.5" r="4.6" />
    <circle cx="29.5" cy="33.5" r="4.6" />
    <circle cx="15.5" cy="33.5" r="1.4" fill="#000" opacity="0.4" />
    <circle cx="29.5" cy="33.5" r="1.4" fill="#000" opacity="0.4" />
    {/* recovered pawn motif behind */}
    <circle cx="38.5" cy="27.5" r="2.1" />
    <path d="M36.5 33.5c.3-2 1-3.4 2-4.2 1 .8 1.7 2.2 2 4.2z" />
  </>
);

const champion: PieceGraphic = (
  <>
    {/* broad helm */}
    <path d="M22.5 5.5c-3.3 0-5.6 2.3-5.6 5.4v2.6h11.2v-2.6c0-3.1-2.3-5.4-5.6-5.4z" />
    {/* twin-layer shield body: outer cracked, inner whole */}
    <path d="M12.5 15.5h20v9c0 5.5-4.2 9.6-10 11.5-5.8-1.9-10-6-10-11.5z" />
    <path d="M17 19h11v5.6c0 3.4-2.4 6-5.5 7.2-3.1-1.2-5.5-3.8-5.5-7.2z" fill="#000" opacity="0.28" />
    {/* crack */}
    <path d="M15.5 16l2.5 4-2 3" fill="none" strokeWidth="1.4" />
    {BASE}
  </>
);

const avenger: PieceGraphic = (
  <>
    {/* ghost silhouettes */}
    <g opacity="0.3">
      <circle cx="11" cy="15" r="2.6" />
      <circle cx="34" cy="15" r="2.6" />
    </g>
    {/* cloaked figure, empty visor */}
    <path d="M22.5 5.5c-4 0-6.8 3.2-6.8 7.2 0 2.4 1 4.2 2.3 5.3l-4.5 15.5h18l-4.5-15.5c1.3-1.1 2.3-2.9 2.3-5.3 0-4-2.8-7.2-6.8-7.2z" />
    <path d="M18.8 11.5h7.4v2.6h-7.4z" fill="#000" opacity="0.5" />
    {/* glowing core */}
    <circle cx="22.5" cy="24.5" r="3" fill="#000" opacity="0.35" />
    <circle cx="22.5" cy="24.5" r="1.4" />
    {BASE}
  </>
);

const general: PieceGraphic = (
  <>
    {/* plumed commander helm */}
    <path d="M18 10c0-3 2-5.5 4.5-5.5S27 7 27 10v3h-9z" />
    <path d="M27 5.5c2.5 0 5 1.5 6.5 4l-4 2z" />
    {/* long coat, upright */}
    <path d="M16.5 13.5h12l2 18h-16z" />
    {/* command staff */}
    <path d="M33.5 12v20" fill="none" strokeWidth="2" />
    <circle cx="33.5" cy="10.5" r="2" />
    {/* aura marks at the base */}
    <path d="M7.5 34.5h4M33.5 34.5h4" fill="none" strokeWidth="1.8" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    {BASE}
  </>
);

const diplomat: PieceGraphic = (
  <>
    {/* masked head */}
    <circle cx="22.5" cy="10" r="4.6" />
    <path d="M18 9.6h9v2.2h-9z" fill="#000" opacity="0.45" />
    {/* two-tone robe: one half hollow */}
    <path d="M22.5 16c-4.8 0-8 3.8-8 8.6V31h16v-6.4c0-4.8-3.2-8.6-8-8.6z" />
    <path d="M22.5 16v15h8v-6.4c0-4.8-3.2-8.6-8-8.6z" fill="#000" opacity="0.35" />
    {/* scroll */}
    <path d="M31.5 20.5l5 .5-1 3-4.5-1z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    {BASE}
  </>
);

const infiltrator: PieceGraphic = (
  <>
    {/* trailing duplicate */}
    <g opacity="0.28">
      <path d="M13.5 9.5c-2.7 0-4.6 2.2-4.6 5v16.5h9.2V14.5c0-2.8-1.9-5-4.6-5z" />
    </g>
    {/* thin hooded blade-carrier */}
    <path d="M25 5.5c-3 0-5.1 2.4-5.1 5.5v20.5h10.2V11c0-3.1-2.1-5.5-5.1-5.5z" />
    <path d="M22.4 10.4h5.2v2h-5.2z" fill="#000" opacity="0.5" />
    {/* short blades */}
    <path d="M31.5 16l4.5 8M18.5 16l-4 8" fill="none" strokeWidth="1.8" />
    {BASE}
  </>
);

const warrior: PieceGraphic = (
  <>
    {/* helm */}
    <path d="M22.5 5.5c-3.2 0-5.4 2.3-5.4 5.2v2.8h10.8v-2.8c0-2.9-2.2-5.2-5.4-5.2z" />
    {/* athletic torso */}
    <path d="M16 14.5h13l2.5 17h-18z" />
    {/* sword right, spear left — two weapon silhouettes */}
    <path d="M33 10l3.5 21" fill="none" strokeWidth="2.2" />
    <path d="M31 14.5l6-1.5" fill="none" strokeWidth="1.8" />
    <path d="M10.5 31.5v-21" fill="none" strokeWidth="2" />
    <path d="M10.5 5.5l2.8 5h-5.6z" />
    {BASE}
  </>
);

/* ------------------------------------------------------------------ */
/* Rook-class pieces. Same placeholder language: strong bases, clear   */
/* silhouettes, one identifying prop each.                             */
/* ------------------------------------------------------------------ */

const berserker: PieceGraphic = (
  <>
    {/* horned head, hunched aggressive mass */}
    <path d="M14.5 9.5l4 3.5-2.5 2zM30.5 9.5l-4 3.5 2.5 2z" />
    <circle cx="22.5" cy="12.5" r="4.4" />
    <path d="M13.5 31.5c0-7 3.5-13 9-13s9 6 9 13z" />
    {/* massive axe */}
    <path d="M33 8.5v22" fill="none" strokeWidth="2.4" />
    <path d="M33 9c3.6.6 6 3 6.8 6.2-2.6.6-5.4.2-6.8-1z" />
    {/* shattered armour shards around the base */}
    <path d="M9 33.5l2.6-3 1.6 3zM31.5 33.5l2.2-3.4 2.6 3.4z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const leper: PieceGraphic = (
  <>
    {/* deep hood, masked face, tattered robe — narrow and alone */}
    <path d="M22.5 5.5c-3.9 0-6.4 3.2-6.4 6.8v3.2h12.8v-3.2c0-3.6-2.5-6.8-6.4-6.8z" />
    <path d="M19.4 11.2h6.2v2h-6.2z" fill="#000" opacity="0.5" />
    <path d="M17 15.5h11l1.8 12-2.6-1.6-2 2.2-2.7-1.8-2.7 1.8-2-2.2-2.6 1.6z" />
    {/* isolation ring: empty ground marked around the base */}
    <path d="M8 34.5h4M33 34.5h4M22.5 34.5h0" fill="none" strokeWidth="1.6" opacity="0.6" />
    <path d="M15 35.5h15" fill="none" strokeWidth="2.4" />
    <rect x="12.5" y="36.5" width="20" height="4.5" rx="2.2" />
  </>
);

const archer: PieceGraphic = (
  <>
    {/* hooded marksman */}
    <path d="M20 6.5c-3.2.6-5.2 3.1-5.2 6.2v2.8h8.4v-2.8c0-2.9-1.3-5.2-3.2-6.2z" />
    <path d="M14.5 16.5h9l1.5 14h-12z" />
    {/* longbow drawn to the right */}
    <path d="M29.5 7c4.6 5 4.6 17.4 0 22.4" fill="none" strokeWidth="2" />
    <path d="M29.5 7l1 22.4" fill="none" strokeWidth="1" opacity="0.7" />
    {/* arrow aimed outward */}
    <path d="M24.5 18.2h13" fill="none" strokeWidth="1.8" />
    <path d="M37.5 18.2l-3.4-2v4z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const batteringRam: PieceGraphic = (
  <>
    {/* armoured wedge with a jutting ram head */}
    <path d="M9.5 15.5h17l10 6.5-10 6.5h-17z" />
    <circle cx="38" cy="22" r="2.6" />
    {/* impact cracks on the plating */}
    <path d="M14 18.5l3 3-2.4 2.8M20.5 17l2 3.4" fill="none" strokeWidth="1.3" opacity="0.75" />
    {/* reinforced wheels */}
    <circle cx="15" cy="33" r="4.8" />
    <circle cx="27.5" cy="33" r="4.8" />
    <circle cx="15" cy="33" r="1.5" fill="#000" opacity="0.4" />
    <circle cx="27.5" cy="33" r="1.5" fill="#000" opacity="0.4" />
  </>
);

const catapult: PieceGraphic = (
  <>
    {/* frame */}
    <path d="M10 31.5l6-12h3.5l-4.5 12z" />
    <path d="M31 31.5l-13-19 2.6-2 13.6 18z" />
    {/* throwing arm and cup with stone */}
    <circle cx="19" cy="10" r="3.4" />
    <path d="M13.5 6.5c2-1.6 5.6-2 8 0l-1.6 2.6c-1.6-1.2-3.6-1-4.8 0z" />
    {/* crossbar + wheels */}
    <path d="M8.5 31.5h28" fill="none" strokeWidth="2.6" />
    <circle cx="13.5" cy="35.5" r="3.6" />
    <circle cx="31.5" cy="35.5" r="3.6" />
  </>
);

const jouster: PieceGraphic = (
  <>
    {/* speed lines behind */}
    <path d="M6 16h7M4.5 21h6M6 26h7" fill="none" strokeWidth="1.6" opacity="0.55" />
    {/* forward-leaning mount head */}
    <path d="M15.5 30.5c0-6.5 3-12.5 8.5-14l1.5-3.8 3.2 1.4 3.6-1 .4 4.2c2.4 3.2 3.8 8 3.8 13.2z" />
    <circle cx="27.2" cy="16.6" r="1.1" fill="#000" opacity="0.55" />
    {/* couched lance */}
    <path d="M20 21.5l19-7.5" fill="none" strokeWidth="2" />
    <path d="M39 14l-3.8-.4 1.8 3z" />
    {/* banner */}
    <path d="M17 13.5l-5.5-2 1.5 4-3.5 1.5 5.5 1.5z" />
    <path d="M13 35.5h21" fill="none" strokeWidth="2.4" />
    <rect x="11" y="36.5" width="25" height="4.5" rx="2.2" />
  </>
);

/* ------------------------------------------------------------------ */
/* Knight-class pieces.                                                */
/* ------------------------------------------------------------------ */

const squire: PieceGraphic = (
  <>
    {/* oversized helmet on a small frame */}
    <path d="M22.5 6c-4.2 0-6.9 3.1-6.9 6.6v3.9h13.8v-3.9c0-3.5-2.7-6.6-6.9-6.6z" />
    <path d="M18.6 12.2h7.8v2h-7.8z" fill="#000" opacity="0.45" />
    <path d="M18 17.5h9l1.4 11h-11.8z" />
    {/* small shield and short sword */}
    <path d="M11.5 19.5h6v5.4c0 2.4-1.4 4-3 4.8-1.6-.8-3-2.4-3-4.8z" />
    <path d="M31.5 15.5v12" fill="none" strokeWidth="1.8" />
    <path d="M29.5 18h4" fill="none" strokeWidth="1.6" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const jester: PieceGraphic = (
  <>
    {/* three-pointed hat with bells */}
    <path d="M22.5 14l-7.5-8 3.5 8-6.5-4 4.5 6 12-.1 4.5-5.9-6.5 4 3.5-8z" />
    <circle cx="14.8" cy="6.2" r="1.6" />
    <circle cx="22.5" cy="4.8" r="1.6" />
    <circle cx="30.2" cy="6.2" r="1.6" />
    {/* split-colour body: one half hollowed */}
    <path d="M22.5 16.5c-4.6 0-7.6 3.9-7.6 8.4v6.6h15.2v-6.6c0-4.5-3-8.4-7.6-8.4z" />
    <path d="M22.5 16.5v15h7.6v-6.6c0-4.5-3-8.4-7.6-8.4z" fill="#000" opacity="0.35" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const ambusher: PieceGraphic = (
  <>
    {/* crouched hooded hunter */}
    <path d="M25.5 8.5c-3 .4-5 2.7-5 5.5v2.5h7.6V14c0-2.6-1-4.6-2.6-5.5z" />
    <path d="M17.5 16.5h11.5l2 9.5h-15z" />
    {/* bow at the side */}
    <path d="M12.5 10c-3.4 4.4-3.4 13.2 0 17.6" fill="none" strokeWidth="1.8" />
    <path d="M12.5 10l-.6 17.6" fill="none" strokeWidth="0.9" opacity="0.7" />
    {/* foliage marks around the base */}
    <path d="M8.5 33.5l2-3 2 3zM31 33.5l2-3 2 3zM20.5 33.5l2-3 2 3z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const spy: PieceGraphic = (
  <>
    {/* masked face with a second mask held aside */}
    <path d="M22.5 5.5c-3.8 0-6.2 3-6.2 6.6v3.1h12.4v-3.1c0-3.6-2.4-6.6-6.2-6.6z" />
    <path d="M19.3 11h6.4v2.2h-6.4z" fill="#000" opacity="0.5" />
    {/* the spare face */}
    <path d="M33 12.5c1.8 0 3.2 1.5 3.2 3.4 0 1.9-1.4 3.4-3.2 3.4z" />
    {/* long cloak */}
    <path d="M16.5 16.5h12l2.5 14h-17z" />
    {/* hidden dagger */}
    <path d="M28 22l4.5 6.5" fill="none" strokeWidth="1.6" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const assassin: PieceGraphic = (
  <>
    {/* low hooded stance */}
    <path d="M24.5 7.5c-2.9.5-4.8 2.7-4.8 5.3v2.4h7.2v-2.4c0-2.4-.9-4.3-2.4-5.3z" />
    <path d="M16 15.5h13.5l3.5 10h-19z" />
    {/* twin curved daggers */}
    <path d="M11.5 14c-1.8 3.4-1.6 7.6.4 10.6" fill="none" strokeWidth="1.8" />
    <path d="M35.5 12.5c2 3.2 2 7.4.2 10.4" fill="none" strokeWidth="1.8" />
    {/* forward chevron on the base: it only moves toward you */}
    <path d="M19.5 32.5l3-3.4 3 3.4z" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const doublePiece: PieceGraphic = (
  <>
    {/* trailing mirror image */}
    <g opacity="0.34">
      <path d="M14 9.5h3.2v2.6h2.6v3H17.2v2.6H14v-2.6h-2.6v-3H14z" />
      <path d="M15.6 19c-4 0-6.8 3-6.8 6.8v5.7h13.6v-5.7c0-3.8-2.8-6.8-6.8-6.8z" />
    </g>
    {/* the double, wearing a king-like cross */}
    <path d="M27.4 7.5h3.2v2.6h2.6v3h-2.6v2.6h-3.2v-2.6h-2.6v-3h2.6z" />
    <path d="M29 17c-4.2 0-7.1 3.2-7.1 7.1v6.4h14.2v-6.4c0-3.9-2.9-7.1-7.1-7.1z" />
    <path d="M13 35.5h20" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

/* ------------------------------------------------------------------ */
/* Bishop-class pieces.                                                */
/* ------------------------------------------------------------------ */

const monk: PieceGraphic = (
  <>
    {/* shaved head with a calm halo arc */}
    <circle cx="22.5" cy="9.5" r="4" />
    <path d="M14.5 6.5c4.4-3.4 11.6-3.4 16 0" fill="none" strokeWidth="1.2" opacity="0.6" />
    {/* robe */}
    <path d="M22.5 14c-4.4 0-7.3 4.3-7.3 8.9v8.6h14.6v-8.6c0-4.6-2.9-8.9-7.3-8.9z" />
    {/* prayer beads */}
    <circle cx="18.8" cy="22.5" r="1.1" />
    <circle cx="20.6" cy="24.6" r="1.1" />
    <circle cx="22.9" cy="25.6" r="1.1" />
    <circle cx="25.3" cy="24.6" r="1.1" />
    <circle cx="27" cy="22.5" r="1.1" />
    {/* staff */}
    <path d="M33.5 8.5v23" fill="none" strokeWidth="1.8" />
    <circle cx="33.5" cy="7" r="1.8" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const shieldmaiden: PieceGraphic = (
  <>
    {/* the enormous forward shield dominates */}
    <path d="M9.5 12.5h13v13c0 5.4-3.2 9.2-6.5 10.8-3.3-1.6-6.5-5.4-6.5-10.8z" />
    <path d="M16 15.5v17.5" fill="none" strokeWidth="1.3" opacity="0.6" />
    {/* warrior behind the shield */}
    <circle cx="28.5" cy="10.5" r="3.6" />
    <path d="M24.5 15.5h8l1.5 13.5h-11z" />
    {/* forward aura ticks */}
    <path d="M6.5 15l-2.5 2.5M6.5 22l-3 0M6.5 29l-2.5-2.5" fill="none" strokeWidth="1.5" opacity="0.7" />
    <path d="M13 35.5h21" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const jailer: PieceGraphic = (
  <>
    {/* iron-masked head */}
    <path d="M22.5 5.5c-3.6 0-6 2.8-6 6.2v3.3h12v-3.3c0-3.4-2.4-6.2-6-6.2z" />
    <path d="M18.5 9h8M18.5 12h8" fill="none" strokeWidth="1.2" opacity="0.6" />
    {/* heavy coat with prison-bar motif */}
    <path d="M16 15.5h13l2 15h-17z" />
    <path d="M19 17.5v11M22.5 17.5v11M26 17.5v11" fill="none" strokeWidth="1.1" opacity="0.55" />
    {/* key ring and chain */}
    <circle cx="33.5" cy="20.5" r="2.6" fill="none" strokeWidth="1.6" />
    <path d="M33.5 23v5M32 26h3" fill="none" strokeWidth="1.4" />
    <path d="M11.5 28c1.5-1.5 3-1.5 4.5 0" fill="none" strokeWidth="1.4" opacity="0.7" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const kingsguard: PieceGraphic = (
  <>
    {/* crowned crest helm */}
    <path d="M18.5 9.5l2-3 2 3 2-3 2 3v4h-8z" />
    {/* armoured body with royal tabard */}
    <path d="M16.5 14.5h12l1.8 14h-15.6z" />
    <path d="M22.5 16.5v10" fill="none" strokeWidth="1.4" opacity="0.6" />
    <path d="M20 20h5" fill="none" strokeWidth="1.4" opacity="0.6" />
    {/* halberd */}
    <path d="M33.5 7v25" fill="none" strokeWidth="1.8" />
    <path d="M33.5 8c2.6.4 4.2 2 4.8 4.2-1.8.5-3.6.2-4.8-.8z" />
    <path d="M13 35.5h21" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

const warhound: PieceGraphic = (
  <>
    {/* lunging armored hound */}
    <path d="M12.5 30.5c0-6 3-11 8-12.5l1-3.6 3.4 1.2 4.6-2.6-.6 4.6 4.6 2.4-4 1.6c1.6 2.6 2.5 5.6 2.5 8.9z" />
    {/* jaw + eye */}
    <path d="M28.5 15.5l5 1.5-4.5 1.8" fill="none" strokeWidth="1.4" />
    <circle cx="25.6" cy="17.6" r="1.1" fill="#000" opacity="0.6" />
    {/* spiked collar + chain */}
    <path d="M20.5 19.5l-1.6-2.4M23.5 18.6l-.6-2.8" fill="none" strokeWidth="1.4" />
    <path d="M8.5 27c1.4-1.4 2.8-1.4 4.2 0M6.5 30c1.4-1.4 2.8-1.4 4.2 0" fill="none" strokeWidth="1.3" opacity="0.7" />
    <path d="M11 35.5h23" fill="none" strokeWidth="2.4" />
    <rect x="9" y="36.5" width="27" height="4.5" rx="2.2" />
  </>
);

const spearman: PieceGraphic = (
  <>
    {/* the very long spear crossing the whole tile */}
    <path d="M8.5 33.5L36 6" fill="none" strokeWidth="2" />
    <path d="M36.5 5.5l-1.2 4.6-3.4-3.4z" />
    {/* narrow braced figure */}
    <circle cx="16.5" cy="14.5" r="3.4" />
    <path d="M13 19.5h7l1.6 12h-10.2z" />
    <path d="M12.5 24.5l-3.5 5" fill="none" strokeWidth="1.6" />
    <path d="M13 35.5h19" fill="none" strokeWidth="2.4" />
    <rect x="10.5" y="36.5" width="24" height="4.5" rx="2.2" />
  </>
);

export const PIECE_GRAPHICS: Record<string, PieceGraphic> = {
  king,
  queen,
  rook,
  bishop,
  knight,
  pawn,
  archbishop,
  trapper,
  revolutionary,
  duelist,
  chariot,
  champion,
  avenger,
  general,
  diplomat,
  infiltrator,
  warrior,
  berserker,
  leper,
  archer,
  'battering-ram': batteringRam,
  catapult,
  jouster,
  squire,
  jester,
  ambusher,
  spy,
  assassin,
  double: doublePiece,
  monk,
  shieldmaiden,
  jailer,
  kingsguard,
  warhound,
  spearman,
};

export const getPieceGraphic = (type: PieceType): PieceGraphic | null =>
  PIECE_GRAPHICS[type] ?? null;
