import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PieceDefinition, SpellDefinition } from '../../engine';
import {
  AVAILABLE_CLASSES,
  CLASS_LABELS,
  allDraftablePieces,
  allSpellCards,
  allTrapCards,
  contentFlags,
  setContentFlags,
} from '../../roster';
import type { AccountUser } from '../../cloud/auth';
import { listAccounts, type DirectoryAccount } from '../../cloud/accounts';
import { setContentEnabled, type ContentKind } from '../../cloud/content';
import { PieceIcon } from '../pieces/PieceIcon';
import { useContentFlags } from '../useContentFlags';

interface AdminDashboardProps {
  /** The signed-in admin; recorded on every change they make. */
  user: AccountUser;
  onBack: () => void;
}

/**
 * Admin dashboard: which pieces and cards the draft currently offers.
 *
 * Switching something off removes it from every player's Army Builder — it is
 * a content decision, not a rule change, so games already under way and games
 * already recorded are untouched (the engine never reads this config).
 *
 * Each toggle is applied locally first and then written to the shared table.
 * If the write is refused — which is what happens to anyone without an admin
 * grant, whatever this screen believes — the change is rolled back and the
 * server's reason is shown.
 */
export function AdminDashboard({ user, onBack }: AdminDashboardProps) {
  const flags = useContentFlags();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [accounts, setAccounts] = useState<readonly DirectoryAccount[]>([]);

  // Who has signed up. Credentials are not part of this and never will be —
  // `auth.users` owns those; this is name, address, joined and last seen.
  useEffect(() => {
    let cancelled = false;
    void listAccounts().then((result) => {
      if (cancelled) return;
      if (result.error) console.warn('account directory unavailable:', result.error);
      else setAccounts(result.accounts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pieces = useMemo(() => allDraftablePieces(), []);
  const spells = useMemo(() => allSpellCards(), []);
  const traps = useMemo(() => allTrapCards(), []);

  const piecesOn = pieces.filter((piece) => !flags.disabledPieces.has(piece.type)).length;
  const cardsOn = [...spells, ...traps].filter((card) => !flags.disabledCards.has(card.id)).length;

  /** Rewrites the live config with one id added to or removed from a set. */
  const applyLocally = useCallback((kind: ContentKind, id: string, enabled: boolean) => {
    const current = contentFlags();
    const pieceIds = new Set(current.disabledPieces);
    const cardIds = new Set(current.disabledCards);
    const target = kind === 'piece' ? pieceIds : cardIds;
    if (enabled) target.delete(id);
    else target.add(id);
    setContentFlags({ pieces: pieceIds, cards: cardIds });
  }, []);

  const toggle = useCallback(
    async (kind: ContentKind, id: string, enabled: boolean) => {
      const key = `${kind}:${id}`;
      setError(null);
      setPending((current) => new Set(current).add(key));
      applyLocally(kind, id, enabled);

      const result = await setContentEnabled(kind, id, enabled, user.id);
      if (result.error) {
        applyLocally(kind, id, !enabled); // roll back to what the server has
        setError(result.error);
      }
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    },
    [applyLocally, user.id],
  );

  const renderToggle = (kind: ContentKind, id: string, enabled: boolean) => {
    const key = `${kind}:${id}`;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${id}`}
        className={`switch${enabled ? ' switch--on' : ''}`}
        disabled={pending.has(key)}
        onClick={() => void toggle(kind, id, !enabled)}
      >
        <span className="switch__knob" />
      </button>
    );
  };

  const renderPiece = (definition: PieceDefinition) => {
    const enabled = !flags.disabledPieces.has(definition.type);
    return (
      <li key={definition.type} className={`adminrow${enabled ? '' : ' adminrow--off'}`}>
        <span className="adminrow__icon">
          <PieceIcon type={definition.type} color="white" />
        </span>
        <span className="adminrow__name">{definition.name}</span>
        <span className="adminrow__cost">{definition.cost} pts</span>
        {renderToggle('piece', definition.type, enabled)}
      </li>
    );
  };

  const renderCard = (definition: SpellDefinition) => {
    const enabled = !flags.disabledCards.has(definition.id);
    return (
      <li key={definition.id} className={`adminrow${enabled ? '' : ' adminrow--off'}`}>
        <span className="adminrow__icon" aria-hidden="true">
          {definition.icon}
        </span>
        <span className="adminrow__name">{definition.name}</span>
        <span className="adminrow__cost">{definition.cost ?? 0} pts</span>
        {renderToggle('card', definition.id, enabled)}
      </li>
    );
  };

  return (
    <div className="app admin">
      <header className="app__header app__header--row">
        <div>
          <h1 className="app__title">Admin dashboard</h1>
          <p className="app__tagline">
            {piecesOn}/{pieces.length} pieces · {cardsOn}/{spells.length + traps.length} cards
            available · signed in as {user.displayName}
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onBack}>
          Menu
        </button>
      </header>

      <p className="admin__note">
        Switched-off content disappears from every player’s Army Builder. Games already in
        progress and games already recorded are unaffected — this decides what may be
        drafted, not how anything plays.
      </p>
      {error && <p className="account__error">{error}</p>}

      {accounts.length > 0 && (
        <section className="panel admin__accounts">
          <h2 className="panel__title">Players — {accounts.length}</h2>
          <ul className="admin__rows">
            {accounts.map((account) => (
              <li key={account.id} className="adminrow adminrow--account">
                <span className="adminrow__name">
                  {account.displayName}
                  {account.isAdmin && (
                    <span className="adminrow__badge" title="Admin">
                      🛡️
                    </span>
                  )}
                </span>
                <span className="adminrow__email">{account.email}</span>
                <span className="adminrow__cost">
                  {account.lastSignInAt
                    ? `seen ${new Date(account.lastSignInAt).toLocaleDateString()}`
                    : 'never signed in'}
                </span>
              </li>
            ))}
          </ul>
          <p className="admin__note admin__note--tight">
            Passwords live in Supabase Auth (<code>auth.users</code>), which is the only place
            they belong — reset one from the dashboard’s Authentication → Users page.
          </p>
        </section>
      )}

      <div className="admin__columns">
        <section className="panel admin__panel">
          <h2 className="panel__title">Pieces</h2>
          <div className="admin__list">
            {AVAILABLE_CLASSES.map((pieceClass) => {
              const group = pieces.filter((piece) => piece.pieceClass === pieceClass);
              if (group.length === 0) return null;
              return (
                <div key={pieceClass}>
                  <p className="admin__group">{CLASS_LABELS[pieceClass]}</p>
                  <ul className="admin__rows">{group.map(renderPiece)}</ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel admin__panel">
          <h2 className="panel__title">Cards</h2>
          <div className="admin__list">
            <p className="admin__group">Spells</p>
            <ul className="admin__rows">{spells.map(renderCard)}</ul>
            <p className="admin__group">Traps</p>
            <ul className="admin__rows">{traps.map(renderCard)}</ul>
          </div>
        </section>
      </div>
    </div>
  );
}
