import { useEffect, useState } from 'react';
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  toAccountUser,
  type AccountUser,
} from './auth';

/**
 * The signed-in user as React state: restored from the persisted session at
 * startup, kept current through auth events. In an unconfigured build this
 * settles immediately at "signed out" and nothing cloud-related renders.
 */
export interface AccountState {
  readonly user: AccountUser | null;
  readonly loading: boolean;
  readonly cloudConfigured: boolean;
}

export function useAccount(): AccountState {
  const cloudConfigured = isCloudConfigured();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(cloudConfigured);

  useEffect(() => {
    if (!cloudConfigured) return;

    let cancelled = false;
    void getSession().then((session) => {
      if (cancelled) return;
      setUser(toAccountUser(session?.user));
      setLoading(false);
    });
    const unsubscribe = onAuthChange((next) => {
      if (!cancelled) setUser(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cloudConfigured]);

  return { user, loading, cloudConfigured };
}
