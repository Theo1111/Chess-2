-- Chess 2 — the account directory
--
-- Run AFTER admin.sql, in the dashboard SQL editor. Idempotent.
--
-- Supabase Auth owns credentials: `auth.users` holds the email and the bcrypt
-- hash, and nothing in `public` may mirror the secret half. Every table and
-- function in `public` is served to the internet by PostgREST using the key
-- that ships in the browser bundle, so a password column here — plaintext or
-- hashed — is one policy mistake away from a dump, and offers the app nothing
-- it cannot already do: `signInWithPassword` verifies against `auth.users`
-- server-side, and the client never holds the password after the form.
--
-- What an admin legitimately needs is the identity half: who has an account,
-- what they are called, when they joined and when they were last seen. That
-- is what this exposes, to admins only.

create or replace function public.list_accounts()
returns table (
  id              uuid,
  email           text,
  display_name    text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  is_admin        boolean
)
language sql
stable
security definer set search_path = public, auth
as $$
  select
    u.id,
    u.email::text,
    coalesce(p.display_name, split_part(u.email::text, '@', 1)),
    u.created_at,
    u.last_sign_in_at,
    exists (select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  -- The gate: a non-admin caller gets an empty table, not an error, so the
  -- UI can call it unconditionally and simply show nothing.
  where public.is_admin()
  order by u.created_at;
$$;

revoke all on function public.list_accounts() from public;
grant execute on function public.list_accounts() to authenticated;
