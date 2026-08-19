/**
 * Cloud reads/writes for match history and saved armies.
 *
 * Same contract as auth.ts: plain result objects, never throws, and a build
 * without Supabase configured answers with a clear error string. All rows are
 * written with the caller's user id; RLS enforces that server-side too.
 */

import { CLOUD_SETUP_HINT, getSupabase } from './supabaseClient';
import type { ArmyRow, MatchRow } from './records';
import type { Roster } from '../roster';

export interface StoredMatch extends MatchRow {
  readonly id: string;
  readonly played_at: string;
}

export interface StoredArmy {
  readonly id: string;
  readonly name: string;
  readonly roster: Roster;
  readonly points: number;
  readonly created_at: string;
}

interface WriteResult {
  readonly error: string | null;
}

interface ListResult<T> {
  readonly rows: readonly T[];
  readonly error: string | null;
}

export async function saveMatch(userId: string, row: MatchRow): Promise<WriteResult> {
  const supabase = await getSupabase();
  if (!supabase) return { error: CLOUD_SETUP_HINT };

  const { error } = await supabase.from('matches').insert({ ...row, user_id: userId });
  return { error: error?.message ?? null };
}

export async function listMatches(userId: string, limit = 50): Promise<ListResult<StoredMatch>> {
  const supabase = await getSupabase();
  if (!supabase) return { rows: [], error: CLOUD_SETUP_HINT };

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit);
  return { rows: (data as StoredMatch[] | null) ?? [], error: error?.message ?? null };
}

export async function saveArmy(userId: string, row: ArmyRow): Promise<WriteResult> {
  const supabase = await getSupabase();
  if (!supabase) return { error: CLOUD_SETUP_HINT };

  const { error } = await supabase.from('saved_armies').insert({ ...row, user_id: userId });
  return { error: error?.message ?? null };
}

export async function listArmies(userId: string, limit = 50): Promise<ListResult<StoredArmy>> {
  const supabase = await getSupabase();
  if (!supabase) return { rows: [], error: CLOUD_SETUP_HINT };

  const { data, error } = await supabase
    .from('saved_armies')
    .select('id, name, roster, points, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { rows: (data as StoredArmy[] | null) ?? [], error: error?.message ?? null };
}

export async function deleteArmy(userId: string, armyId: string): Promise<WriteResult> {
  const supabase = await getSupabase();
  if (!supabase) return { error: CLOUD_SETUP_HINT };

  const { error } = await supabase
    .from('saved_armies')
    .delete()
    .eq('id', armyId)
    .eq('user_id', userId);
  return { error: error?.message ?? null };
}
