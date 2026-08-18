import { useState } from 'react';
import {
  allSpellDefinitions,
  getSpellDefinition,
  visibleOpponentSpells,
  opposite,
  type GameState,
  type SpellDefinition,
} from '../../engine';

interface SpellBarProps {
  game: GameState;
  /** The spell currently armed and awaiting a target, if any. */
  casting: { spell: string; first: number | null } | null;
  onSelect: (spell: string) => void;
  onCancel: () => void;
}

/** Targeting prompt for the armed spell. */
function castingPrompt(spell: string, stage: 'first' | 'second'): string {
  switch (spell) {
    case 'shield':
      return 'Select a piece to shield';
    case 'freeze':
      return 'Select an enemy piece to freeze';
    case 'teleport':
      return stage === 'first' ? 'Select a piece to teleport' : 'Select a destination square';
    case 'sacrifice':
      return stage === 'first' ? 'Select a piece to sacrifice' : 'Select an adjacent enemy of equal value';
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

/**
 * The current player's card loadout, split into its two deck types. Only the
 * cards this army brought appear — the rest of the library does not exist in
 * this match. Own cards are always visible; the opponent's only after Reveal
 * (via the sanctioned selector — the UI never reads the hidden book).
 */
export function SpellBar({ game, casting, onSelect, onCancel }: SpellBarProps) {
  const [inspected, setInspected] = useState<string | null>(null);
  const mover = game.turn;
  const book = game.spells[mover];
  const opponentBook = visibleOpponentSpells(game, mover);

  if (book.available.length === 0 && book.used.length === 0) return null; // cards disabled

  const owned = allSpellDefinitions().filter(
    (definition) => book.available.includes(definition.id) || book.used.includes(definition.id),
  );
  const spells = owned.filter((definition) => !definition.isTrap);
  const traps = owned.filter((definition) => definition.isTrap === true);

  const renderCard = (definition: SpellDefinition) => {
    const used = book.used.includes(definition.id);
    const active = casting?.spell === definition.id;
    const uncastable =
      !used && definition.castable !== undefined && !definition.castable(game, mover);
    return (
      <button
        key={definition.id}
        type="button"
        className={[
          'spellcard',
          definition.isTrap ? 'spellcard--trap' : '',
          used ? 'spellcard--used' : '',
          uncastable ? 'spellcard--locked' : '',
          active ? 'spellcard--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={used || uncastable || game.phase !== 'main' || game.pawnOrder !== null}
        onClick={() => onSelect(definition.id)}
        onMouseEnter={() => setInspected(definition.id)}
        onMouseLeave={() => setInspected((current) => (current === definition.id ? null : current))}
      >
        <span className="spellcard__icon" aria-hidden="true">
          {definition.icon}
        </span>
        <span className="spellcard__name">{definition.name}</span>
        {used && <span className="spellcard__tag">used</span>}
      </button>
    );
  };

  const moverName = mover === 'white' ? 'White' : 'Black';

  return (
    <>
      {spells.length > 0 && (
        <section className="panel spellbar">
          <h2 className="panel__title">Spells — {moverName}</h2>
          <div className="spellbar__cards">{spells.map(renderCard)}</div>

          {inspected &&
            getSpellDefinition(inspected).isTrap !== true &&
            getSpellDefinition(inspected).artwork && (
            <div className="spellbar__preview" aria-hidden="true">
              <img
                src={getSpellDefinition(inspected).artwork}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </div>
          )}

          {casting && (
            <div className="spellbar__prompt">
              <span>
                {getSpellDefinition(casting.spell).icon}{' '}
                {castingPrompt(casting.spell, casting.first === null ? 'first' : 'second')}
              </span>
              <button type="button" className="button button--ghost spellbar__cancel" onClick={onCancel}>
                Cancel
              </button>
            </div>
          )}

          {inspected && !casting && (
            <p className="spellbar__info">
              <strong>{getSpellDefinition(inspected).name}</strong> ·{' '}
              {getSpellDefinition(inspected).isTrap ? 'one-time trap' : 'one-time spell'} —{' '}
              {getSpellDefinition(inspected).description}
            </p>
          )}

          {opponentBook && (
            <div className="spellbar__revealed">
              <span className="spellbar__revealed-title">
                👁️ {opposite(mover) === 'white' ? 'White' : 'Black'}’s remaining cards
              </span>
              <span className="spellbar__revealed-cards">
                {opponentBook.available.length === 0
                  ? 'none'
                  : opponentBook.available
                      .map((id) => `${getSpellDefinition(id).icon} ${getSpellDefinition(id).name}`)
                      .join(' · ')}
              </span>
            </div>
          )}
        </section>
      )}

      {traps.length > 0 && (
        <section className="panel spellbar spellbar--traps">
          <h2 className="panel__title">Traps — {moverName}</h2>
          <div className="spellbar__cards">{traps.map(renderCard)}</div>
          {inspected &&
            getSpellDefinition(inspected).isTrap === true &&
            getSpellDefinition(inspected).artwork && (
              <div className="spellbar__preview" aria-hidden="true">
                <img
                  src={getSpellDefinition(inspected).artwork}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              </div>
            )}
        </section>
      )}
    </>
  );
}
