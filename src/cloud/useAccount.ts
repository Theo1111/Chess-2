import { useEffect, useState } from 'react';
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  toAccountUser,
  type AccountUser,
} from './auth';
import { isAdminAccount } from './content';

/**
 * The signed-in user as React state: restored from the persisted session at
 * startup, kept current through auth events. In an unconfigured build this
 * settles immediately at "signed out" and nothing cloud-related renders.
 */
export interface AccountState {
  readonly user: AccountUser | null;
  readonly loading: boolean;
  readonly cloudConfigured: boolean;
  /**
   * True when this account holds an admin grant. It only decides whether the
   * dashboard is offered — every write is checked again by row-level
   * security, so faking this client-side buys nothing.
   */
  readonly isAdmin: boolean;
}

export function useAccount(): AccountState {
  const cloudConfigured = isCloudConfigured();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(cloudConfigured);
  const [isAdmin, setIsAdmin] = useState(false);

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

  // Signing out (or in as somebody else) re-asks; the answer is never cached
  // across accounts.
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void isAdminAccount(user.id).then((admin) => {
      if (!cancelled) setIsAdmin(admin);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { user, loading, cloudConfigured, isAdmin };
}
