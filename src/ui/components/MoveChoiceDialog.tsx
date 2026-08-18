import { getPieceDefinition, type Color, type Move } from '../../engine';
import { PieceIcon } from '../pieces/PieceIcon';

interface MoveChoiceDialogProps {
  color: Color;
  options: readonly Move[];
  onChoose: (move: Move) => void;
  onCancel: () => void;
}

/**
 * Presented when one square-to-square gesture maps to several distinct moves:
 * promotion pieces, an ability variant (defect, return a pawn), or both.
 * Options come straight from the engine, so new ability variants just appear.
 */
export function MoveChoiceDialog({ color, options, onChoose, onCancel }: MoveChoiceDialogProps) {
  const isPromotion = options.every((move) => move.promotion);
  const isTransform = options.every((move) => move.special === 'transform');
  const title = isTransform ? 'Transform into' : isPromotion ? 'Promote to' : 'Choose';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Choose move">
      <div className="modal__backdrop" onClick={onCancel} />
      <div className="modal__card">
        <h2 className="modal__title">{title}</h2>
        <div className={isPromotion ? 'modal__choices' : 'modal__choices modal__choices--list'}>
          {options.map((move, index) => (
            <button
              key={index}
              type="button"
              className="promotion"
              onClick={() => onChoose(move)}
            >
              {move.promotion ? (
                <>
                  <PieceIcon type={move.promotion} color={color} />
                  <span>{getPieceDefinition(move.promotion).name}</span>
                </>
              ) : (
                <>
                  <span className="promotion__label">{describeOption(move)}</span>
                  <span className="promotion__detail">{describeDetail(move)}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function describeOption(move: Move): string {
  if (move.special === 'defect') return 'Defect';
  if (move.special === 'royal-swap') return 'Royal Swap';
  if (move.special === 'ambush') return 'Ambush';
  if (move.returns) return 'Move & return Pawn';
  if (move.captured && move.captured.square !== move.to) return 'Stab';
  if (move.captured) return 'Capture';
  return 'Move';
}

function describeDetail(move: Move): string {
  if (move.special === 'defect') return 'Sacrifice this piece — both players swap armies';
  if (move.special === 'royal-swap') return 'Exchange squares with your King';
  if (move.special === 'ambush')
    return `Capture the ${getPieceDefinition(move.captured?.type ?? 'pawn').name} that passed through this square`;
  if (move.returns) return `A captured ${getPieceDefinition(move.returns.type).name} returns to the vacated square`;
  if (move.captured && move.captured.square !== move.to)
    return `Kill the ${getPieceDefinition(move.captured.type).name} beyond, stopping here`;
  if (move.captured) return 'A normal capture';
  return 'A normal move';
}
