import { useState, type CSSProperties } from 'react';
import {
  getSpellDefinition,
  opposite,
  visibleOpponentSpells,
  type CardKind,
  type Color,
  type GameState,
  type Square,
  type SpellDefinition,
} from '../../engine';

/**
 * A player's hand of cards, drawn along one edge of the board.
 *
 * Hands are asymmetric on purpose, exactly like a card game played across a
 * table: the viewer's own cards lie face up and are playable, the opponent's
 * are card backs — a count, not a list. The only thing that turns an enemy
 * card face up is the game itself (Reveal, or a trap firing), never the UI.
 *
 * Spent cards move to a small pile beside the hand. The viewer's pile is face
 * up because it is their own information; the opponent's stays face down,
 * since a trap they have set is still hidden until it triggers.
 */
interface CardHandProps {
  game: GameState;
  /** Which player's cards these are. */
  color: Color;
  /** 'own' = face up and playable; 'opponent' = across the table, face down. */
  side: 'own' | 'opponent';
  /** The card currently armed and waiting for its target(s), if any. */
  casting?: { readonly spell: string; readonly first: Square | null } | null;
  onSelect?: (spell: string) => void;
  onCancel?: () => void;
  /** False while it is not this player's turn (or the game is over). */
  playable?: boolean;
}

/** Targeting prompt for the armed card. */
function castingPrompt(spell: string, stage: 'first' | 'second'): string {
  switch (spell) {
    case 'shield':
      return 'Select a piece to shield';
    case 'freeze':
      return 'Select an enemy piece to freeze';
    case 'teleport':
      return stage === 'first' ? 'Select a piece to teleport' : 'Select a destination square';
    case 'sacrifice':
      return stage === 'first'
        ? 'Select a piece to sacrifice'
        : 'Select an adjacent enemy of equal value';
    case 'smoke-screen':
      return 'Select the centre of the smoke';
    case 'null-field':
      return 'Select the centre of the null field';
    case 'sacred-ground':
      return 'Select a square to consecrate';
    case 'last-stand':
      return 'Select a piece to protect';
    case 'interference':
      return 'Select a revealed enemy trap';
    case 'mirror-shield':
      return 'Select a piece to guard';
    case 'crown-of-command':
      return 'Select a non-royal piece to crown';
    case 'decay':
      return 'Select an enemy piece to curse';
    case 'transform':
      return 'Select an enemy piece to transform';
    case 'wall':
      return stage === 'first'
        ? 'Select the first empty square of the wall'
        : 'Select an adjacent empty square';
    case 'portal':
      return stage === 'first' ? 'Select the first gate’s square' : 'Select the second gate’s square';
    case 'tripwire':
    case 'sonar':
    case 'web-trap':
    case 'dead-zone':
    case 'mine':
      return 'Select an empty square for your hidden trap';
    default:
      return 'Select a target';
  }
}

const colorName = (color: Color): string => (color === 'white' ? 'White' : 'Black');

/** What to call each kind in the hand's rules line. */
const KIND_NOUNS: Readonly<Record<CardKind, string>> = {
  spell: 'spell',
  trap: 'trap',
  relic: 'relic',
  curse: 'curse',
  terrain: 'terrain card',
};

/** The face of a card: its official artwork, or an icon-and-name fallback. */
function CardFace({ definition }: { definition: SpellDefinition }) {
  if (definition.artwork) {
    return (
      <img
        className="handcard__art"
        src={definition.artwork}
        alt={definition.name}
        loading="lazy"
        draggable={false}
      />
    );
  }
  return (
    <span className="handcard__plain">
      <span className="handcard__icon" aria-hidden="true">
        {definition.icon}
      </span>
      <span className="handcard__name">{definition.name}</span>
    </span>
  );
}

/** The reverse of a card — the only thing an opponent's hand ever shows. */
function CardBack({ className = '' }: { className?: string }) {
  return (
    <span className={`cardback ${className}`.trim()} aria-hidden="true">
      <span className="cardback__crest">♛</span>
    </span>
  );
}

export function CardHand({
  game,
  color,
  side,
  casting = null,
  onSelect,
  onCancel,
  playable = false,
}: CardHandProps) {
  const [inspected, setInspected] = useState<string | null>(null);

  const book = game.spells[color];
  if (book.available.length === 0 && book.used.length === 0) return null; // no cards in play

  // An opponent's book is readable only through the sanctioned selector, and
  // only once the game has made it public.
  const faceUp = side === 'own' || visibleOpponentSpells(game, opposite(color)) !== null;
  const armable = playable && game.phase === 'main' && game.pawnOrder === null;

  const cards = book.available.map((id) => getSpellDefinition(id));

  const renderOwn = (definition: SpellDefinition, index: number) => {
    const active = casting?.spell === definition.id;
    const uncastable =
      definition.castable !== undefined && !definition.castable(game, color);
    return (
      <button
        key={definition.id}
        type="button"
        style={{ '--index': index } as CSSProperties}
        className={[
          'handcard',
          `handcard--${definition.kind}`,
          uncastable ? 'handcard--locked' : '',
          active ? 'handcard--armed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={!armable || uncastable}
        aria-label={`${definition.name} — ${definition.description}`}
        onClick={() => onSelect?.(definition.id)}
        onMouseEnter={() => setInspected(definition.id)}
        onMouseLeave={() =>
          setInspected((current) => (current === definition.id ? null : current))
        }
        onFocus={() => setInspected(definition.id)}
        onBlur={() => setInspected((current) => (current === definition.id ? null : current))}
      >
        <CardFace definition={definition} />
      </button>
    );
  };

  const inspectedCard = inspected ? getSpellDefinition(inspected) : null;

  return (
    <section className={`hand hand--${side}`} aria-label={`${colorName(color)}'s cards`}>
      <span className="hand__owner">
        {colorName(color)}
        <span className="hand__count">
          {book.available.length} card{book.available.length === 1 ? '' : 's'}
        </span>
      </span>

      <div className="hand__cards">
        {side === 'own'
          ? cards.map(renderOwn)
          : cards.map((definition, index) =>
              faceUp ? (
                // Revealed: the opponent's remaining cards are public knowledge.
                <span
                  key={definition.id}
                  style={{ '--index': index } as CSSProperties}
                  className="handcard handcard--enemy handcard--open"
                  title={`${definition.name} — ${definition.description}`}
                >
                  <CardFace definition={definition} />
                </span>
              ) : (
                <span
                  key={index}
                  style={{ '--index': index } as CSSProperties}
                  className="handcard handcard--enemy"
                >
                  <CardBack />
                </span>
              ),
            )}
        {cards.length === 0 && <span className="hand__empty">no cards left</span>}
      </div>

      {book.used.length > 0 && (
        <div className="hand__spent" title={`${book.used.length} card(s) spent`}>
          {side === 'own' ? (
            book.used.map((id, index) => (
              <span
                key={`${id}-${index}`}
                style={{ '--index': index } as CSSProperties}
                className="handcard handcard--spent"
                title={getSpellDefinition(id).name}
              >
                <CardFace definition={getSpellDefinition(id)} />
              </span>
            ))
          ) : (
            // A spell the opponent cast was announced when it resolved, so it
            // lies face up. A spent TRAP card may still be armed on the board:
            // it stays face down until the game itself reveals it.
            book.used.map((id, index) => {
              const definition = getSpellDefinition(id);
              return (
                <span
                  key={`${id}-${index}`}
                  style={{ '--index': index } as CSSProperties}
                  className="handcard handcard--spent"
                  title={definition.isTrap ? 'A card was set' : definition.name}
                >
                  {definition.isTrap ? <CardBack /> : <CardFace definition={definition} />}
                </span>
              );
            })
          )}
          <span className="hand__spent-count">{book.used.length} spent</span>
        </div>
      )}

      {side === 'own' && casting && (
        <div className="hand__prompt">
          <span>
            {getSpellDefinition(casting.spell).icon}{' '}
            {castingPrompt(casting.spell, casting.first === null ? 'first' : 'second')}
          </span>
          <button type="button" className="button button--ghost hand__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      {side === 'own' && !casting && inspectedCard && (
        <p className="hand__info">
          <strong>{inspectedCard.name}</strong> · one-time {KIND_NOUNS[inspectedCard.kind]} —{' '}
          {inspectedCard.description}
        </p>
      )}
    </section>
  );
}
