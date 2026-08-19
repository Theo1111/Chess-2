import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase connection — optional by design, loaded lazily by necessity.
 *
 * Chess 2 is a local-first game: the engine, the balance laboratory and every
 * screen work with no network and no account. Cloud features (sign-in, saved
 * armies, match history) light up only when a project is configured, and the
 * whole app degrades to "signed out, nothing to sync" otherwise. Nothing in
 * `src/engine` or `src/balance` may ever import this module.
 *
 * The SDK itself is a dynamic import: ~230 KB that unconfigured builds and
 * signed-out play should never download, so it stays out of the main chunk
 * and is fetched once on first cloud call.
 *
 * Configure with a `.env.local` at the repo root (never committed):
 *
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<publishable anon key>
 *
 * The anon key is the browser-side publishable key; row-level security in
 * `supabase/schema.sql` is what actually protects the data, so this key alone
 * grants nobody access to anybody else's rows.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const configured = Boolean(url && anonKey);

let clientPromise: Promise<SupabaseClient> | null = null;

/** True when a Supabase project is configured for this build. */
export const isCloudConfigured = (): boolean => configured;

/**
 * The client, or null when unconfigured. Callers must handle null rather
 * than assume a connection — that is what keeps the game playable offline.
 */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!configured) return null;
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    }),
  );
  return clientPromise;
}

/** Shown in the UI when someone opens the account panel with no project set. */
export const CLOUD_SETUP_HINT =
  'Cloud accounts are not configured for this build. Add VITE_SUPABASE_URL and ' +
  'VITE_SUPABASE_ANON_KEY to .env.local and restart the dev server.';
