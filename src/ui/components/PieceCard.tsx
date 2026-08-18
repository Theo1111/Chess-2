import type { Color, PieceDefinition } from '../../engine';
import { CLASS_LABELS } from '../../roster';
import { PieceIcon } from '../pieces/PieceIcon';

interface PieceCardProps {
  definition: PieceDefinition;
  color: Color;
}

/** The collectible-card view of a piece: name, cost, class, movement, ability. */
export function PieceCard({ definition, color }: PieceCardProps) {
  return (
    <article className="card">
      <header className="card__header">
        <div className="card__portrait">
          <PieceIcon type={definition.type} color={color} />
        </div>
        <div>
          <h3 className="card__name">{definition.name}</h3>
          <p className="card__class">
            {definition.pieceClass ? CLASS_LABELS[definition.pieceClass] : ''} ·{' '}
            {definition.cost ?? 0} Points
          </p>
        </div>
      </header>
      <dl className="card__body">
        <div>
          <dt>Movement</dt>
          <dd>{definition.movementText ?? '—'}</dd>
        </div>
        <div>
          <dt>Ability</dt>
          <dd>{definition.abilityText ?? 'No special ability.'}</dd>
        </div>
      </dl>
      {definition.flavor && <p className="card__flavor">“{definition.flavor}”</p>}
    </article>
  );
}
