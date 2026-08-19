import { useEffect, useRef, useState } from 'react';
import type { AccountUser } from '../../cloud/auth';
import { AccountPanel } from './AccountPanel';

interface AccountCornerProps {
  user: AccountUser | null;
  cloudConfigured: boolean;
  onShowHistory: () => void;
}

/**
 * The account control in the top-right corner: a compact chip showing who is
 * signed in (or "Sign in"), which opens the full panel as a popover. Keeping
 * the form behind a chip stops a sign-in box from competing with the menu's
 * actual choices — starting a game.
 */
export function AccountCorner({ user, cloudConfigured, onShowHistory }: AccountCornerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape closes; so does a click anywhere outside the popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const label = user ? user.displayName : cloudConfigured ? 'Sign in' : 'Account';

  return (
    <div className="account-corner" ref={containerRef}>
      <button
        type="button"
        className={`account-corner__chip${user ? ' account-corner__chip--in' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="account-corner__avatar" aria-hidden="true">
          {user ? user.displayName.charAt(0).toUpperCase() : '👤'}
        </span>
        <span className="account-corner__label">{label}</span>
      </button>

      {open && (
        <div className="account-corner__popover" role="dialog" aria-label="Account">
          <AccountPanel
            user={user}
            cloudConfigured={cloudConfigured}
            onShowHistory={() => {
              setOpen(false);
              onShowHistory();
            }}
          />
        </div>
      )}
    </div>
  );
}
