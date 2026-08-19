import { useState, type FormEvent } from 'react';
import { signIn, signOut, signUp, type AccountUser } from '../../cloud/auth';
import { CLOUD_SETUP_HINT } from '../../cloud/supabaseClient';

interface AccountPanelProps {
  user: AccountUser | null;
  cloudConfigured: boolean;
  onShowHistory: () => void;
}

/**
 * Menu-corner account box: sign in / create account when signed out, a
 * greeting + history + sign out when signed in, and a setup hint when the
 * build has no Supabase project configured.
 *
 * The password field is real account auth handled entirely by Supabase's SDK
 * over HTTPS — it is never logged or stored by the app itself.
 */
export function AccountPanel({ user, cloudConfigured, onShowHistory }: AccountPanelProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!cloudConfigured) {
    return (
      <section className="panel account">
        <h2 className="panel__title">Account</h2>
        <p className="account__hint">{CLOUD_SETUP_HINT}</p>
      </section>
    );
  }

  if (user) {
    return (
      <section className="panel account">
        <h2 className="panel__title">Account</h2>
        <p className="account__who">
          Signed in as <strong>{user.displayName}</strong>
          <span className="account__email">{user.email}</span>
        </p>
        <p className="account__hint">Finished games are saved to your match history.</p>
        <div className="account__actions">
          <button type="button" className="button" onClick={onShowHistory}>
            Match history
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result =
      mode === 'signup'
        ? await signUp(email, password, displayName)
        : await signIn(email, password);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
    } else if (mode === 'signup') {
      setMessage('Account created. Check your email if confirmation is required.');
    }
  };

  return (
    <section className="panel account">
      <h2 className="panel__title">Account</h2>
      <p className="account__hint">
        {mode === 'signin'
          ? 'Sign in to save your finished games and armies.'
          : 'Create an account to save your games across devices.'}
      </p>
      <form className="account__form" onSubmit={(event) => void submit(event)}>
        {mode === 'signup' && (
          <input
            className="account__input"
            type="text"
            placeholder="Display name"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        )}
        <input
          className="account__input"
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="account__input"
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      {message && <p className="account__message">{message}</p>}
      <button
        type="button"
        className="account__switch"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setMessage(null);
        }}
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </section>
  );
}
