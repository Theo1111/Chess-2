import { Fragment, useMemo, useState } from 'react';
import type { Color, PieceDefinition, PieceType, SpellDefinition } from '../../engine';
import {
  AVAILABLE_CLASSES,
  CLASS_LABELS,
  addUnit,
  availableSpellCards,
  availableTrapCards,
  canAfford,
  canAffordCard,
  cardCost,
  costOf,
  draftablePieces,
  isCompositionLegal,
  isMandatory,
  remainingBudget,
  removeLastUnitOfType,
  removeUnit,
  rosterCost,
  toggleSpellCard,
  toggleTrapCard,
  unitCost,
  validateComposition,
  validateLoadout,
  type Roster,
} from '../../roster';
import { PieceCardFace, PieceCardOverlay } from '../components/PieceCardOverlay';
import { PieceIcon } from '../pieces/PieceIcon';

interface TeamBuilderProps {
  color: Color;
  roster: Roster;
  onChange: (roster: Roster) => void;
  onConfirm: () => void;
  onBack: () => void;
  /** Offered to the second player: copy the first player's army. */
  onMirror?: () => void;
}

type BuilderTab = 'pieces' | 'cards' | 'operator';

export function TeamBuilder({ color, roster, onChange, onConfirm, onBack, onMirror }: TeamBuilderProps) {
  const catalog = useMemo(() => draftablePieces(), []);
  const spellPool = useMemo(() => availableSpellCards(), []);
  const trapPool = useMemo(() => availableTrapCards(), []);
  const [inspected, setInspected] = useState<PieceType>(catalog[0]?.type ?? 'queen');
  const [tab, setTab] = useState<BuilderTab>('pieces');
  /**
   * `inspected` drives the card docked in the right-hand column — hovering a
   * catalog row re-points it instantly. Clicking a row additionally pins that
   * card as a focused modal.
   */
  const [pinnedPiece, setPinnedPiece] = useState<PieceType | null>(null);

  const compositionErrors = validateComposition(roster);
  const loadoutErrors = validateLoadout(roster);
  const spent = rosterCost(roster);
  const remaining = remainingBudget(roster);
  const dockedDefinition = catalog.find((definition) => definition.type === inspected) ?? catalog[0];
  const pinnedDefinition = pinnedPiece
    ? (catalog.find((definition) => definition.type === pinnedPiece) ?? null)
    : null;
  const readyToPlace = isCompositionLegal(roster) && loadoutErrors.length === 0;
  const feedback = compositionErrors[0]?.message ?? loadoutErrors[0]?.message ?? null;

  /** Bought units grouped by type for the army list. */
  const armyCounts = useMemo(() => {
    const counts = new Map<PieceType, number>();
    for (const unit of roster.units) {
      if (isMandatory(unit)) continue;
      counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
    }
    return counts;
  }, [roster.units]);

  const renderRow = (definition: PieceDefinition) => {
    const count = armyCounts.get(definition.type) ?? 0;
    const affordable = canAfford(roster, definition.type);
    return (
      <li
        key={definition.type}
        className={`catalog__row${inspected === definition.type ? ' catalog__row--active' : ''}`}
        onMouseEnter={() => setInspected(definition.type)}
      >
        <button
          type="button"
          className="catalog__info"
          aria-haspopup="dialog"
          onClick={() => {
            setInspected(definition.type);
            setPinnedPiece(definition.type);
          }}
        >
          <span className="catalog__icon">
            <PieceIcon type={definition.type} color={color} />
          </span>
          <span className="catalog__name">{definition.name}</span>
          <span className="catalog__cost">{definition.cost}</span>
        </button>
        <span className="catalog__controls">
          <button
            type="button"
            className="chip"
            disabled={count === 0}
            aria-label={`Remove ${definition.name}`}
            onClick={() => onChange(removeLastUnitOfType(roster, definition.type))}
          >
            −
          </button>
          <span className={`catalog__count${count ? ' catalog__count--some' : ''}`}>{count}</span>
          <button
            type="button"
            className="chip"
            disabled={!affordable}
            aria-label={`Add ${definition.name}`}
            onClick={() => onChange(addUnit(roster, definition.type))}
          >
            +
          </button>
        </span>
      </li>
    );
  };

  const renderCardTile = (definition: SpellDefinition) => {
    const trap = definition.isTrap === true;
    const selected = trap ? roster.trapIds : roster.spellIds;
    const isSelected = selected.includes(definition.id);
    // Cards compete with pieces for the same points now.
    const locked = !isSelected && !canAffordCard(roster, definition.id);
    const price = definition.cost ?? 0;
    const toggle = trap ? toggleTrapCard : toggleSpellCard;
    return (
      <button
        key={definition.id}
        type="button"
        className={[
          'deckcard',
          definition.artwork ? 'deckcard--art' : '',
          isSelected ? 'deckcard--selected' : '',
          locked ? 'deckcard--locked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={isSelected}
        aria-label={`${isSelected ? 'Remove' : 'Select'} ${definition.name} (${price} points)`}
        title={`${definition.name} (${price} pts) — ${definition.description}`}
        onClick={() => onChange(toggle(roster, definition.id))}
      >
        {definition.artwork ? (
          // The card face is the whole identity: name, type banner and
          // rules text are painted into the artwork itself.
          <img
            className="deckcard__artimg"
            src={definition.artwork}
            alt={definition.name}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <>
            <span className="deckcard__icon" aria-hidden="true">
              {definition.icon}
            </span>
            <span className="deckcard__name">{definition.name}</span>
            <span className="deckcard__text">{definition.description}</span>
          </>
        )}
        <span className="deckcard__cost">{price} {price === 1 ? 'pt' : 'pts'}</span>
        {isSelected && <span className="deckcard__check">✓</span>}
      </button>
    );
  };

  /** One CARDS tab: spells and traps are a single priced category, one grid,
      grouped by kind the way the piece catalog groups by class. */
  const renderCards = () => {
    const selectedCount = roster.spellIds.length + roster.trapIds.length;
    return (
      <section className="panel deck">
        <h2 className="panel__title">
          Cards — {selectedCount} selected · {cardCost(roster)} pts
          <span className="deck__full"> · {remaining} left in budget</span>
        </h2>
        <div className="deck__grid">
          <div className="deck__heading">Spells</div>
          {spellPool.map(renderCardTile)}
          <div className="deck__heading">Traps</div>
          {trapPool.map(renderCardTile)}
        </div>
        {remaining === 0 && (
          <p className="deck__hint">
            Budget spent — remove a card or a piece to make room.
          </p>
        )}
      </section>
    );
  };

  return (
    <div className="screen screen--builder">
      <header className="screen__header">
        <button type="button" className="button button--ghost screen__back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="screen__title">Build your army</h1>
          <p className="screen__subtitle">
            <span className={`swatch swatch--${color}`} /> {color === 'white' ? 'White' : 'Black'} ·
            budget <strong>{spent}</strong> / {roster.budget}
            {remaining > 0 && <span className="screen__hint"> · {remaining} left</span>}
          </p>
        </div>
      </header>

      <nav className="builder-tabs" aria-label="Army sections">
        {(
          [
            { id: 'pieces', label: `Pieces ${unitCost(roster)} pts` },
            { id: 'cards', label: `Cards ${cardCost(roster)} pts` },
            { id: 'operator', label: 'Operator' },
          ] as { id: BuilderTab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`builder-tab${tab === id ? ' builder-tab--active' : ''}`}
            disabled={id === 'operator'}
            title={id === 'operator' ? 'Operators arrive in a later update' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'operator' && <span className="builder-tab__soon">soon</span>}
          </button>
        ))}
      </nav>

      {tab === 'pieces' && (
        <div className="builder">
          <section className="panel builder__army">
            <h2 className="panel__title">Your army</h2>
            <ul className="army">
              <li className="army__row army__row--king">
                <span className="catalog__icon">
                  <PieceIcon type="king" color={color} />
                </span>
                <span className="catalog__name">King</span>
                <span className="army__tag">required</span>
              </li>
              {roster.units.filter((unit) => !isMandatory(unit)).map((unit) => (
                <li key={unit.id} className="army__row">
                  <span className="catalog__icon">
                    <PieceIcon type={unit.type} color={color} />
                  </span>
                  <span className="catalog__name">
                    {catalog.find((definition) => definition.type === unit.type)?.name ?? unit.type}
                  </span>
                  <span className="catalog__cost">{costOf(unit.type)}</span>
                  <button
                    type="button"
                    className="chip"
                    aria-label="Remove from army"
                    onClick={() => onChange(removeUnit(roster, unit.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel builder__catalog">
            <h2 className="panel__title">Available pieces</h2>
            <ul className="catalog">
              {AVAILABLE_CLASSES.map((pieceClass) => (
                <Fragment key={pieceClass}>
                  <li className="catalog__heading">{CLASS_LABELS[pieceClass]}</li>
                  {catalog
                    .filter((definition) => definition.pieceClass === pieceClass)
                    .map(renderRow)}
                </Fragment>
              ))}
            </ul>
          </section>

          <aside className="builder__card">
            {dockedDefinition && (
              <PieceCardFace
                definition={dockedDefinition}
                color={color}
                count={armyCounts.get(dockedDefinition.type) ?? 0}
                canAdd={canAfford(roster, dockedDefinition.type)}
                onAdd={() => onChange(addUnit(roster, dockedDefinition.type))}
                onRemove={() => onChange(removeLastUnitOfType(roster, dockedDefinition.type))}
              />
            )}
          </aside>
        </div>
      )}

      {tab === 'cards' && renderCards()}

      {/* Persistent budget summary + confirm, visible on every tab. One pool:
          pieces and cards spend the same points. */}
      <footer className="panel builder__summary">
        <div className="builder__summary-grid">
          <span>
            <strong>Total</strong> {spent} / {roster.budget} pts
          </span>
          <span>
            <strong>Pieces</strong> {roster.units.length - 1} + King · {unitCost(roster)} pts
          </span>
          <span>
            <strong>Cards</strong> {roster.spellIds.length} spells + {roster.trapIds.length} traps ·{' '}
            {cardCost(roster)} pts
          </span>
        </div>
        {feedback && <p className="builder__error">{feedback}</p>}
        <div className="builder__summary-actions">
          {onMirror && (
            <button type="button" className="button" onClick={onMirror}>
              Mirror White’s army
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={!readyToPlace}
            onClick={onConfirm}
          >
            Place army →
          </button>
        </div>
      </footer>

      {pinnedDefinition && (
        <PieceCardOverlay
          definition={pinnedDefinition}
          color={color}
          count={armyCounts.get(pinnedDefinition.type) ?? 0}
          canAdd={canAfford(roster, pinnedDefinition.type)}
          onAdd={() => onChange(addUnit(roster, pinnedDefinition.type))}
          onRemove={() => onChange(removeLastUnitOfType(roster, pinnedDefinition.type))}
          onClose={() => setPinnedPiece(null)}
        />
      )}
    </div>
  );
}
