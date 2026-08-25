/**
 * The published content config: which pieces and cards the draft offers.
 *
 * One shared table (`content_flags`, see `supabase/admin.sql`) that everybody
 * reads and only an admin may write. A missing row means "available", so the
 * table only ever stores deviations from the shipped catalog and an empty
 * table — or an unconfigured build, or a failed request — means the game is
 * exactly as it ships. That fallback is deliberate: a network problem must
 * never take content away from a player mid-draft.
 *
 * Same contract as the rest of `src/cloud`: plain result objects, no throws.
 */

import { getSupabase } from './supabaseClient';

export type ContentKind = 'piece' | 'card';

export interface DisabledContent {
  readonly pieces: readonly string[];
  readonly cards: readonly string[];
}

const NONE: DisabledContent = { pieces: [], cards: [] };

interface FlagRow {
  readonly kind: ContentKind;
  readonly item_id: string;
}

/**
 * Everything currently switched off. Errors are reported but still answer
 * with the shipped catalog, which is the safe direction to fail in.
 */
export async function fetchDisabledContent(): Promise<
  DisabledContent & { readonly error: string | null }
> {
  const supabase = await getSupabase();
  if (!supabase) return { ...NONE, error: null }; // no cloud: nothing is switched off

  const { data, error } = await supabase
    .from('content_flags')
    .select('kind,item_id')
    .eq('enabled', false);

  if (error || !data) return { ...NONE, error: error?.message ?? null };

  const rows = data as FlagRow[];
  return {
    pieces: rows.filter((row) => row.kind === 'piece').map((row) => row.item_id),
    cards: rows.filter((row) => row.kind === 'card').map((row) => row.item_id),
    error: null,
  };
}

/**
 * Switches one piece or card on or off. Writes are refused by row-level
 * security for anyone who is not an admin — this call is the convenience,
 * the policy is the rule.
 */
export async function setContentEnabled(
  kind: ContentKind,
  itemId: string,
  enabled: boolean,
  adminId: string,
): Promise<{ readonly error: string | null }> {
  const supabase = await getSupabase();
  if (!supabase) return { error: 'Cloud is not configured.' };

  const { error } = await supabase.from('content_flags').upsert(
    {
      kind,
      item_id: itemId,
      enabled,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    },
    { onConflict: 'kind,item_id' },
  );
  return { error: error?.message ?? null };
}

/**
 * Whether this account may change the config. The client asks so it knows
 * whether to offer the dashboard; the server decides whether a write lands.
 * Anything unexpected (table missing because `admin.sql` has not been run,
 * no session, offline) answers "no".
 */
export async function isAdminAccount(userId: string): Promise<boolean> {
  const supabase = await getSupabase();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !error && data !== null;
}
