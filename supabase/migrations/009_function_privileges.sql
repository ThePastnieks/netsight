-- NetSight — stop exposing trigger functions through the REST API.
--
-- Run in Supabase → SQL Editor → Run, after 008. Safe to run again.
--
-- Supabase publishes every function in `public` at /rest/v1/rpc/<name>. The four
-- below are trigger functions: calling them directly always fails, but there is
-- no reason to list them. Triggers keep working: Postgres checks EXECUTE only
-- when a trigger is created, not when it fires.
--
-- is_admin() and my_role() stay callable on purpose: row level security policies
-- call them as the signed-in (or anonymous) role.

revoke execute on function public.gear_check_after()    from public, anon, authenticated;
revoke execute on function public.gear_check_before()   from public, anon, authenticated;
revoke execute on function public.guard_sighting_update() from public, anon, authenticated;
revoke execute on function public.handle_new_user()     from public, anon, authenticated;

-- Pin the search path of the one function that did not set it.
alter function public.touch_updated_at() set search_path = public;
