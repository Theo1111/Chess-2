import { DEFAULT_ROSTER_BUDGET } from '../../roster';
import type { AccountState } from '../../cloud/useAccount';
import { AccountCorner } from '../components/AccountCorner';
import { TIME_CONTROLS, type TimeControlId } from '../timeControls';

interface MainMenuProps {
  onClassic: () => void;
  onDraft: () => void;
  onOnline: () => void;
  timeControl: TimeControlId;
  onTimeControl: (id: TimeControlId) => void;
  account: AccountState;
  onShowHistory: () => void;
}

export function MainMenu({
  onClassic,
  onDraft,
  onOnline,
  timeControl,
  onTimeControl,
  account,
  onShowHistory,
}: MainMenuProps) {
  return (
    <div className="menu">
      <AccountCorner
        user={account.user}
        cloudConfigured={account.cloudConfigured}
        onShowHistory={onShowHistory}
      />

      <h1 className="menu__title">
        Chess<span className="app__title-mark">2</span>
      </h1>
      <p className="menu__tagline">Build your army. Take the board.</p>

      <div className="menu__options">
        <button type="button" className="menu__option" onClick={onDraft}>
          <span className="menu__option-name">Custom armies</span>
          <span className="menu__option-detail">
            One {DEFAULT_ROSTER_BUDGET}-point budget for everything — pieces, spells and
            traps. Draft your mix, deploy it your way, and battle.
          </span>
        </button>
        <button type="button" className="menu__option" onClick={onClassic}>
          <span className="menu__option-name">Classic chess</span>
          <span className="menu__option-detail">The standard game, untouched.</span>
        </button>
        {account.cloudConfigured && (
          <button
            type="button"
            className="menu__option"
            disabled={!account.user}
            title={account.user ? undefined : 'Sign in (top right) to play online'}
            onClick={onOnline}
          >
            <span className="menu__option-name">Play online</span>
            <span className="menu__option-detail">
              {account.user
                ? 'Classic chess against another signed-in player, matched by time control.'
                : 'Sign in (top right) to be matched against another player.'}
            </span>
          </button>
        )}
      </div>

      {/* One clock setting for both modes; it applies to the next game started. */}
      <section className="menu__timing" aria-label="Time control">
        <h2 className="menu__timing-title">Time per player</h2>
        <div className="menu__timing-options" role="radiogroup" aria-label="Time per player">
          {TIME_CONTROLS.map((control) => (
            <button
              key={control.id}
              type="button"
              role="radio"
              aria-checked={timeControl === control.id}
              className={`timechip${timeControl === control.id ? ' timechip--active' : ''}`}
              onClick={() => onTimeControl(control.id)}
            >
              {control.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
