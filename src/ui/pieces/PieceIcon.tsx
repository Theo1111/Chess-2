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
 */
export function PieceIcon({ type, color, className }: PieceIconProps) {
  const definition = getPieceDefinition(type);
  const graphic = getPieceGraphic(type);
  const classes = ['piece', `piece--${color}`, className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      viewBox="0 0 45 45"
      role="img"
      aria-label={`${color} ${definition.name}`}
    >
      {graphic ?? (
        <text x="22.5" y="32" textAnchor="middle" fontSize="26" fontWeight="700">
          {definition.notation || definition.symbol.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
