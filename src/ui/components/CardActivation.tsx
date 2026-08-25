import { getSpellDefinition, type Color } from '../../engine';
import type { CardActivation as Activation } from '../useCardActivations';
import { RailgunStrike } from './RailgunStrike';

/**
 * The card moment: a played card slams into the middle of the screen, spins,
 * and turns face up in a burst of light before fading back into the game.
 *
 * A trap being SET plays the same entrance but never flips — the card stays
 * face down, because that is exactly what the opponent is allowed to know.
 * It turns over later, when the trap actually fires.
 *
 * Purely decorative: it never blocks input (pointer-events: none) and the
 * game underneath continues regardless of where the animation is.
 */
interface CardActivationProps {
  activation: Activation | null;
}

const colorName = (color: Color): string => (color === 'white' ? 'White' : 'Black');

const headline: Readonly<Record<Activation['kind'], string>> = {
  cast: 'Spell activated',
  set: 'Card set',
  trigger: 'Trap activated',
};

export function CardActivation({ activation }: CardActivationProps) {
  if (!activation) return null;

  // One card does not get a card flip. It gets a railgun.
  if (activation.spell === 'rulers-authority') {
    return <RailgunStrike key={activation.id} caster={activation.color} />;
  }

  const definition = activation.spell ? getSpellDefinition(activation.spell) : null;
  const faceDown = definition === null;

  return (
    <div
      // Keyed by occurrence so a second cast restarts the animation instead
      // of inheriting a finished one.
      key={activation.id}
      className={`activation activation--${activation.kind}${faceDown ? ' activation--facedown' : ''}`}
      aria-live="polite"
    >
      <div className="activation__glare" aria-hidden="true" />
      <div className="activation__stage">
        <div className="activation__rays" aria-hidden="true" />
        <div className="activation__ring" aria-hidden="true" />
        <div className="activation__card">
          <div className="activation__flip">
            <div className="activation__face activation__face--back">
              <span className="cardback">
                <span className="cardback__crest">♛</span>
              </span>
            </div>
            <div className="activation__face activation__face--front">
              {definition?.artwork ? (
                <img src={definition.artwork} alt="" draggable={false} />
              ) : (
                <span className="activation__plain">
                  <span className="activation__icon" aria-hidden="true">
                    {definition?.icon}
                  </span>
                  <span className="activation__plain-name">{definition?.name}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="activation__banner">
        <span className="activation__kind">
          {colorName(activation.color)} — {headline[activation.kind]}
        </span>
        <span className="activation__name">{definition ? definition.name : 'Face down'}</span>
      </p>
    </div>
  );
}
