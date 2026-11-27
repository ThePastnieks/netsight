-- NetSight — "is it still there?" answers from boaters.
--
-- Run in Supabase → SQL Editor → Run, AFTER 007. Safe to run again.
--
-- When a boat comes within about 50 m of a reported object in daylight, the app
-- asks "is it still there?". Each answer is one row here. The database, not the
-- app, applies the rules, so they cannot be bypassed from a modified client:
--
--   "here"  confirms the report: last_confirmed_at moves to now, the count of
--           confirmations goes up, and any "gone" votes before it are forgotten.
--   "gone"  counts as a vote. When 2 DIFFERENT people have said gone since the
--           last confirmation, an undecided report is closed (status resolved).
--           A report patrol has already accepted is never closed by boaters:
--           its gone_votes just rises, and patrol sees it on the collect list.
--
-- One answer per person per report per 6 hours, so one person cannot vote twice.
-- Registered gear (registered_gear) is not asked about at all: the owner takes
-- it out and updates the registry himself.

-- ================================================================== columns
alter table public.sightings
  add column if not exists last_confirmed_at timestamptz,
  add column if not exists confirmations integer not null default 0,
  add column if not exists gone_votes integer not null default 0;

-- ================================================================== answers
create table if not exists public.gear_checks (
  id           uuid primary key default gen_random_uuid(),
  sighting_id  uuid not null references public.sightings(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  user_name    text not null,
  answer       text not null check (answer in ('here', 'gone')),
  distance_m   real,
  created_at   timestamptz not null default now()
);

create index if not exists idx_gear_checks_sighting on public.gear_checks(sighting_id, created_at desc);
create index if not exists idx_gear_checks_user on public.gear_checks(user_id, sighting_id, created_at desc);

alter table public.gear_checks enable row level security;

drop policy if exists "read gear checks" on public.gear_checks;
create policy "read gear checks" on public.gear_checks
  for select using (auth.role() = 'authenticated');

-- You may only answer as yourself. Nobody edits an answer afterwards.
drop policy if exists "answer as myself" on public.gear_checks;
create policy "answer as myself" on public.gear_checks
  for insert with check (auth.uid() = user_id);

drop policy if exists "admins delete gear checks" on public.gear_checks;
create policy "admins delete gear checks" on public.gear_checks
  for delete using (public.is_admin());

grant select, insert, delete on public.gear_checks to authenticated;
grant select on public.gear_checks to anon;

-- ============================================== guard: let the system write
-- 007's guard stops a reporter writing patrol fields. The vote trigger below has
-- to update the sighting on behalf of someone who is not its reporter, so it
-- raises a flag for the duration of its own statement; the guard honours it.
-- The new counters are also patrol/system-only.
create or replace function public.guard_sighting_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('netsight.system', true), '') = 'on'
     or public.is_admin()
     or public.my_role() = 'patrol' then
    return new;
  end if;

  if new.reported_by is distinct from old.reported_by
     or new.reporter_name is distinct from old.reporter_name
     or new.lat is distinct from old.lat
     or new.lon is distinct from old.lon
     or new.span is distinct from old.span
     or new.created_at is distinct from old.created_at then
    raise exception 'A report cannot be moved or re-assigned'
      using errcode = '42501';
  end if;

  if new.severity is distinct from old.severity
     or new.verdict is distinct from old.verdict
     or new.decline_reason is distinct from old.decline_reason
     or new.handled_by is distinct from old.handled_by
     or new.handled_at is distinct from old.handled_at
     or new.inspector_id is distinct from old.inspector_id
     or new.last_confirmed_at is distinct from old.last_confirmed_at
     or new.confirmations is distinct from old.confirmations
     or new.gone_votes is distinct from old.gone_votes then
    raise exception 'Only the water patrol can decide a case'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('new', 'reported', 'resolved') then
    raise exception 'That status is set by the water patrol'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ====================================================== one answer per 6 hours
create or replace function public.gear_check_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.gear_checks
    where sighting_id = new.sighting_id
      and user_id = new.user_id
      and created_at > now() - interval '6 hours'
  ) then
    raise exception 'You already answered for this report. Try again later.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists gear_check_before on public.gear_checks;
create trigger gear_check_before
  before insert on public.gear_checks
  for each row execute function public.gear_check_before();

-- ========================================================== apply the answer
create or replace function public.gear_check_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.sightings%rowtype;
  votes    integer;
  needed   constant integer := 2;     -- different people who must say "gone"
begin
  select * into s from public.sightings where id = new.sighting_id for update;
  if not found then return new; end if;

  perform set_config('netsight.system', 'on', true);

  if new.answer = 'here' then
    update public.sightings
       set last_confirmed_at = new.created_at,
           confirmations = confirmations + 1,
           gone_votes = 0
     where id = s.id;
    return new;
  end if;

  -- "gone": count different people since the last confirmation
  select count(distinct user_id) into votes
    from public.gear_checks
   where sighting_id = s.id
     and answer = 'gone'
     and created_at > coalesce(s.last_confirmed_at, '-infinity'::timestamptz);

  if votes >= needed
     and s.verdict is null
     and s.status in ('new', 'reported') then
    update public.sightings
       set gone_votes = votes,
           status = 'resolved',
           handled_by = 'boaters',
           handled_at = new.created_at,
           note = left(coalesce(nullif(s.note, ''), '') ||
                       case when coalesce(s.note, '') = '' then '' else ' · ' end ||
                       'Gone: ' || votes || ' boaters', 500)
     where id = s.id;
  else
    update public.sightings set gone_votes = votes where id = s.id;
  end if;

  return new;
end;
$$;

drop trigger if exists gear_check_after on public.gear_checks;
create trigger gear_check_after
  after insert on public.gear_checks
  for each row execute function public.gear_check_after();

-- ============================================================ done
-- Check it worked: as two different accounts, insert answer 'gone' for the same
-- undecided report (select id from sightings where verdict is null limit 1);
-- after the second one, that report's status is 'resolved'.
