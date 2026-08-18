import { getPieceDefinition, opposite, type Color, type GameState, type PieceType } from '../../engine';
import { PieceIcon } from '../pieces/PieceIcon';

interface CapturedPiecesProps {
  game: GameState;
  /** The player whose captures are shown. */
  color: Color;
}

const materialValue = (types: readonly PieceType[]): number =>
  types.reduce((total, type) => total + getPieceDefinition(type).value, 0);

const byValueDescending = (a: PieceType, b: PieceType): number =>
  getPieceDefinition(b).value - getPieceDefinition(a).value;

export function CapturedPieces({ game, color }: CapturedPiecesProps) {
  const taken = [...game.captured[color]].sort(byValueDescending);
  const advantage = materialValue(game.captured[color]) - materialValue(game.captured[opposite(color)]);

  return (
    <div className="captured">
      <span className="captured__label">{color === 'white' ? 'White' : 'Black'} captured</span>
      <span className="captured__pieces">
        {taken.map((type, index) => (
          <PieceIcon
            key={`${type}-${index}`}
            type={type}
            color={opposite(color)}
            className="piece--captured"
          />
        ))}
        {taken.length === 0 && <span className="captured__none">—</span>}
      </span>
      {advantage > 0 && <span className="captured__advantage">+{advantage}</span>}
    </div>
  );
}
