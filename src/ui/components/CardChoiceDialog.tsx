import { getPieceDefinition, type Color, type PieceType } from '../../engine';
import { PieceIcon } from '../pieces/PieceIcon';

interface CardChoiceDialogProps {
  /** The card asking the question, for the title. */
  card: string;
  /** Colour to draw the offered pieces in — the victim's, not the caster's. */
  color: Color;
  options: readonly PieceType[];
  onChoose: (type: PieceType) => void;
  onCancel: () => void;
}

/**
 * Presented when a card asks its caster to name a piece as well as a target:
 * the Transform curse picks what its victim becomes. The options come from
 * the card's own `choices` list, so the engine decides what is legal and
 * this only draws it.
 */
export function CardChoiceDialog({
  card,
  color,
  options,
  onChoose,
  onCancel,
}: CardChoiceDialogProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${card} — choose a piece`}>
      <div className="modal__backdrop" onClick={onCancel} />
      <div className="modal__card">
        <h2 className="modal__title">{card} into</h2>
        <div className="modal__choices">
          {options.map((type) => {
            const definition = getPieceDefinition(type);
            return (
              <button
                key={type}
                type="button"
                className="promotion"
                title={definition.movementText}
                onClick={() => onChoose(type)}
              >
                <PieceIcon type={type} color={color} />
                <span>{definition.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
