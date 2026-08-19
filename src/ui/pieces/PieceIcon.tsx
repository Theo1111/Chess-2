import { useId } from 'react';
import { getPieceDefinition, type Color, type PieceType } from '../../engine';
import { getPieceGraphic } from './pieceGraphics';

interface PieceIconProps {
  type: PieceType;
  color: Color;
  className?: string;
}

/**
 * Renders a piece. Falls back to the piece's notation letter if no artwork is
 * registered — so an experimental Chess 2 piece is still playable before it
 * has a drawing.
 *
 * Each piece draws in two passes over the same silhouette:
 *   1. an outline pass — a bold dark rim that keeps the edge crisp against
 *      the painted board;
 *   2. a body pass — a vertical gradient (lit top, shaded base) that gives
 *      the flat sculpt some dimension.
 * Gradient ids come from useId so the many inline SVGs on a board never
 * collide (duplicate SVG ids resolve to the first DOM instance, which may
 * unmount).
 */
export function PieceIcon({ type, color, className }: PieceIconProps) {
  const uid = useId();
  const definition = getPieceDefinition(type);
  const graphic = getPieceGraphic(type);
  const classes = ['piece', `piece--${color}`, className].filter(Boolean).join(' ');
  const bodyId = `${uid}-body`;

  const content = graphic ?? (
    <text x="22.5" y="32" textAnchor="middle" fontSize="26" fontWeight="700">
      {definition.notation || definition.symbol.toUpperCase()}
    </text>
  );

  return (
    <svg
      className={classes}
      viewBox="0 0 45 45"
      role="img"
      aria-label={`${color} ${definition.name}`}
    >
      <defs>
        {color === 'white' ? (
          <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#f2efe6" />
            <stop offset="1" stopColor="#cfc9b8" />
          </linearGradient>
        ) : (
          <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#555e6c" />
            <stop offset="0.5" stopColor="#343b45" />
            <stop offset="1" stopColor="#1a1e24" />
          </linearGradient>
        )}
      </defs>
      <g className="piece__outline">{content}</g>
      <g className="piece__body" fill={`url(#${bodyId})`}>
        {content}
      </g>
    </svg>
  );
}
