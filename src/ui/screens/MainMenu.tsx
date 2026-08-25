import { DEFAULT_ROSTER_BUDGET } from '../../roster';
import type { AccountState } from '../../cloud/useAccount';
import { AccountCorner } from '../components/AccountCorner';

interface MainMenuProps {
  onDraft: () => void;
  onOnline: () => void;
  account: AccountState;
  onShowHistory: () => void;
  /** Opens the content dashboard. Only shown to admin accounts. */
  onOpenAdmin: () => void;
}

export function MainMenu({
  onDraft,
  onOnline,
  account,
  onShowHistory,
  onOpenAdmin,
}: MainMenuProps) {
  return (
    <div className="menu">
      <AccountCorner
        user={account.user}
        cloudConfigured={account.cloudConfigured}
        isAdmin={account.isAdmin}
        onShowHistory={onShowHistory}
        onOpenAdmin={onOpenAdmin}
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
                ? 'Draft an army against another signed-in player, on a clock you both agree to.'
                : 'Sign in (top right) to be matched against another player.'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
