-- NetSight — table grants.
--
-- Run this in Supabase → SQL Editor → Run. Safe to run again.
--
-- Why it is needed: row level security decides which ROWS a role may touch, but
-- Postgres also checks whether the role may touch the TABLE at all. Tables made
-- with `create table` in the SQL editor do not get table privileges granted
-- automatically, so every request fails with
--
--   401 {"code":"42501","message":"permission denied for table profiles",
--        "hint":"Grant the required privileges ..."}
--
-- Both checks must pass: the grant lets the role reach the table, the policy
-- decides what it may see.
--
-- The grants below are deliberately broad for `authenticated` and read-only for
-- `anon`, because that is what row level security expects. Policies are what
-- actually restrict — anon has no policy that would return a row, so it still
-- sees nothing.

grant usage on schema public to anon, authenticated;

-- Signed-in users: the policies decide the rest.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous: table access only, no rows. Every policy in this database requires
-- auth.uid() or auth.role() = 'authenticated', so this yields zero rows.
grant select on all tables in schema public to anon;

-- Future tables inherit the same rights, so adding one later does not repeat
-- this problem.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant select on tables to anon;

-- Sequences, for completeness: the app uses uuid defaults today, but a table
-- with a serial column would need this.
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ============================================================ done
-- Check it worked:
--   select * from public.profiles;        -- as a signed-in user: your own row
--   the anon key should now return []    -- not a 42501 error
