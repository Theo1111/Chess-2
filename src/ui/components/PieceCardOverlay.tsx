import { useEffect } from 'react';
import type { Color, PieceDefinition } from '../../engine';
import { CLASS_LABELS } from '../../roster';
import { PieceIcon } from '../pieces/PieceIcon';
import { pieceCardArt } from '../pieces/pieceCardArt';

interface PieceCardOverlayProps {
  definition: PieceDefinition;
  color: Color;
  count: number;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * The card's centre image. Today every piece renders its vector icon; when
 * painted piece art arrives, point this at the asset (a definition field or a
 * type→art registry) and nothing else in the card has to change.
 */
function PiecePortrait({ definition, color }: { definition: PieceDefinition; color: Color }) {
  const art = definition.metadata?.portrait;
  if (typeof art === 'string') {
    return <img className="piece-card-overlay__art" src={art} alt="" loading="lazy" draggable={false} />;
  }
  return <PieceIcon type={definition.type} color={color} />;
}

/**
 * Large Army Builder card overlay.
 * The engine's PieceDefinition is the source of truth for all card text —
 * name, class, cost, movement, ability and flavour are read live, never
 * duplicated here.
 */
export function PieceCardOverlay({
  definition,
  color,
  count,
  canAdd,
  onAdd,
  onRemove,
  onClose,
}: PieceCardOverlayProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="piece-card-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${definition.name} card`}
    >
      <button
        type="button"
        className="piece-card-overlay__backdrop"
        aria-label="Close piece card"
        onClick={onClose}
      />
      <PieceCardFace
        definition={definition}
        color={color}
        count={count}
        canAdd={canAdd}
        onAdd={onAdd}
        onRemove={onRemove}
        onClose={onClose}
      />
    </div>
  );
}

/**
 * The card itself. Rendered inline as the builder's right-hand inspector, and
 * again inside the modal wrapper when a piece is pinned — one markup, one set
 * of styles, so the docked and focused views can never drift apart.
 */
export function PieceCardFace({
  definition,
  color,
  count,
  canAdd,
  onAdd,
  onRemove,
  onClose,
}: Omit<PieceCardOverlayProps, 'onClose'> & { onClose?: () => void }) {
  const art = pieceCardArt(definition.type);
  const actions = (
    <CardActions
      definition={definition}
      count={count}
      canAdd={canAdd}
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );

  // A painted card carries its own frame and text, so it replaces the drawn
  // face entirely; only the roster controls are laid over it.
  if (art) {
    return (
      <article className="piece-card-overlay__card piece-card-overlay__card--art">
        {onClose && <CloseButton onClose={onClose} />}
        <img
          className="piece-card-overlay__cardart"
          src={art}
          alt={describeCard(definition)}
          loading="lazy"
          draggable={false}
        />
        {actions}
      </article>
    );
  }

  return (
      <article className="piece-card-overlay__card">
        {onClose && <CloseButton onClose={onClose} />}

        <header className="piece-card-overlay__header">
          <div>
            <p className="piece-card-overlay__eyebrow">
              {definition.pieceClass ? CLASS_LABELS[definition.pieceClass] : 'Piece'}
            </p>
            <h2 className="piece-card-overlay__name">{definition.name}</h2>
          </div>
          <div className="piece-card-overlay__cost" aria-label={`${definition.cost ?? 0} points`}>
            <strong>{definition.cost ?? 0}</strong>
            <span>PTS</span>
          </div>
        </header>

        <div className="piece-card-overlay__portrait" aria-hidden="true">
          <div className="piece-card-overlay__portrait-glow" />
          <PiecePortrait definition={definition} color={color} />
        </div>

        <div className="piece-card-overlay__rules">
          <section>
            <h3>Movement</h3>
            <p>{definition.movementText ?? '—'}</p>
          </section>
          <section>
            <h3>Ability</h3>
            <p>{definition.abilityText ?? 'No special ability.'}</p>
          </section>
        </div>

        {definition.flavor && (
          <blockquote className="piece-card-overlay__flavor">“{definition.flavor}”</blockquote>
        )}

        {actions}
      </article>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="piece-card-overlay__close"
      aria-label="Close piece card"
      onClick={onClose}
    >
      ×
    </button>
  );
}

/**
 * Roster controls. Shared by the drawn and painted faces so both drive the same
 * handlers — opening a card never changes the army by itself.
 */
function CardActions({
  definition,
  count,
  canAdd,
  onAdd,
  onRemove,
}: Pick<PieceCardOverlayProps, 'definition' | 'count' | 'canAdd' | 'onAdd' | 'onRemove'>) {
  return (
    <footer className="piece-card-overlay__footer">
      <div className="piece-card-overlay__owned">
        <span>In army</span>
        <strong>{count}</strong>
      </div>
      <div className="piece-card-overlay__actions">
        <button type="button" className="button" disabled={count === 0} onClick={onRemove}>
          − Remove
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!canAdd}
          onClick={onAdd}
        >
          + Add · {definition.cost ?? 0} pts
        </button>
      </div>
    </footer>
  );
}

/**
 * Alt text for a painted card, read from the definition rather than the image
 * so assistive tech gets the authoritative rules, not the printed ones.
 */
function describeCard(definition: PieceDefinition): string {
  const label = definition.pieceClass ? `${CLASS_LABELS[definition.pieceClass]} piece` : 'Piece';
  return [
    `${definition.name}, ${label}, ${definition.cost ?? 0} points.`,
    definition.movementText,
    definition.abilityText,
  ]
    .filter(Boolean)
    .join(' ');
}
