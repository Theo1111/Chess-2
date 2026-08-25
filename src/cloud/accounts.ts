/**
 * The account directory — who has signed up, for the Admin dashboard.
 *
 * Credentials are not here and never will be: `auth.users` owns the email and
 * the password hash, and nothing in the `public` schema mirrors the secret
 * half (see `supabase/accounts.sql` for why). What this reads is the identity
 * half — name, address, joined, last seen — and only for an admin: the
 * function returns an empty set to anybody else, so a non-admin caller gets a
 * blank list rather than an error.
 */

import { getSupabase } from './supabaseClient';

export interface DirectoryAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly lastSignInAt: string | null;
  readonly isAdmin: boolean;
}

interface AccountRow {
  readonly id: string;
  readonly email: string | null;
  readonly display_name: string | null;
  readonly created_at: string;
  readonly last_sign_in_at: string | null;
  readonly is_admin: boolean;
}

export async function listAccounts(): Promise<{
  readonly accounts: readonly DirectoryAccount[];
  readonly error: string | null;
}> {
  const supabase = await getSupabase();
  if (!supabase) return { accounts: [], error: null };

  const { data, error } = await supabase.rpc('list_accounts');
  if (error || !data) return { accounts: [], error: error?.message ?? null };

  const rows = data as AccountRow[];
  return {
    accounts: rows.map((row) => ({
      id: row.id,
      email: row.email ?? '—',
      displayName: row.display_name ?? 'Player',
      createdAt: row.created_at,
      lastSignInAt: row.last_sign_in_at,
      isAdmin: row.is_admin,
    })),
    error: null,
  };
}
