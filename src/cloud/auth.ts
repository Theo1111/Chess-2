import type { Session, User } from '@supabase/supabase-js';
import { CLOUD_SETUP_HINT, getSupabase, isCloudConfigured } from './supabaseClient';

/**
 * Account operations.
 *
 * Every call returns a plain `{ error }` result instead of throwing, so the
 * UI can show a message without try/catch at each call site, and an
 * unconfigured build answers "not configured" rather than exploding.
 */

export interface AccountResult {
  readonly error: string | null;
}

export interface AccountUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

const NOT_CONFIGURED: AccountResult = { error: CLOUD_SETUP_HINT };

export function toAccountUser(user: User | null | undefined): AccountUser | null {
  if (!user) return null;
  const meta = user.user_metadata as { display_name?: string } | undefined;
  const email = user.email ?? '';
  return {
    id: user.id,
    email,
    displayName: meta?.display_name?.trim() || email.split('@')[0] || 'Player',
  };
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<AccountResult> {
  const supabase = await getSupabase();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    // Read by the profiles trigger in schema.sql.
    options: { data: { display_name: displayName.trim() || email.split('@')[0] } },
  });
  return { error: error?.message ?? null };
}

export async function signIn(email: string, password: string): Promise<AccountResult> {
  const supabase = await getSupabase();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<AccountResult> {
  const supabase = await getSupabase();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signOut();
  return { error: error?.message ?? null };
}

/** Current session at startup, or null when signed out / unconfigured. */
export async function getSession(): Promise<Session | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Subscribes to sign-in/out. Returns an unsubscribe function. */
export function onAuthChange(handler: (user: AccountUser | null) => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  void getSupabase().then((supabase) => {
    if (!supabase || cancelled) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      handler(toAccountUser(session?.user));
    });
    unsubscribe = () => data.subscription.unsubscribe();
  });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export { isCloudConfigured };
