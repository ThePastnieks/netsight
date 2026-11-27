-- NetSight — hardening that does not change what anyone can do.
--
-- Run in Supabase → SQL Editor → Run. Safe to run again.
--
-- 1. A reporter keeps the right to close their own report (the net was taken
--    out, the buoy was collected). What a reporter may NOT do is write the
--    fields that belong to patrol: severity, verdict, decline reason, who
--    handled it, or a status only patrol hands out (checked / false_alarm).
--    Before this, the update policy let a reporter write any column of their
--    own row.
--
-- 2. The photo bucket accepts images only, up to 8 MB. Before this, any signed-in
--    account could upload any file of any size to a public bucket.
--
-- Nothing here touches telemetry or the buoy API: the hardware is not decided
-- yet, so that part is left alone on purpose.

-- ====================================================== sightings: who sets what
create or replace function public.guard_sighting_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The SQL editor, migrations and the service key have no auth.uid(); they are
  -- trusted. Patrol and admin are staff and may write anything.
  if auth.uid() is null
     or public.is_admin()
     or public.my_role() = 'patrol' then
    return new;
  end if;

  -- Everyone else is a reporter editing their own report.
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
     or new.inspector_id is distinct from old.inspector_id then
    raise exception 'Only the water patrol can decide a case'
      using errcode = '42501';
  end if;

  -- A reporter may move their report between new, reported and resolved.
  -- checked and false_alarm are patrol decisions.
  if new.status is distinct from old.status
     and new.status not in ('new', 'reported', 'resolved') then
    raise exception 'That status is set by the water patrol'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sighting_update on public.sightings;
create trigger guard_sighting_update
  before update on public.sightings
  for each row execute function public.guard_sighting_update();

-- ================================================================ photo bucket
update storage.buckets
set file_size_limit = 8388608,                       -- 8 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'sightings-photos';

-- ============================================================ done
-- Check it worked (as a normal user, from the app): reporting and resolving
-- your own report still works; writing `severity` on it is refused with
--   42501 Only the water patrol can decide a case
