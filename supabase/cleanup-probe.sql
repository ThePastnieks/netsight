-- NetSight — remove the test data my verification left behind.
--
-- Run in Supabase → SQL Editor → New query → Run.
--
-- Why this file exists: checking the live database meant creating an account and
-- a few rows. The anon key cannot delete them — the delete policy is
-- admin-only, which is correct — so they need the database owner's rights.
--
-- Identified by the exact marker text, so your own reports are not touched.
-- Your four reports (test2, Normis) stay.

-- ---------------------------------------------------------------- what is there
-- Run this on its own first if you want to see it before deleting anything.
select id, user_class, note, reporter_name, created_at
from public.sightings
order by created_at desc;

-- ---------------------------------------------------------------- the deletions

-- Messages on the probe cases. Deleting the sighting cascades, but doing it
-- explicitly means this file is safe to run twice.
delete from public.case_messages
where case_id in (
  select id from public.sightings
  where note = '[DELETE ME] probe test row' or reporter_name = 'probe'
);

-- The two probe reports.
delete from public.sightings
where note = '[DELETE ME] probe test row' or reporter_name = 'probe';

-- Any nets the probe registered (it deleted its own already, so usually 0 rows).
delete from public.registered_gear
where owner_name = 'probe';

-- The probe profile.
delete from public.profiles
where username like 'probe%';

-- The probe auth user. Without this the sign-in still works even though the
-- profile is gone, and the app says "that account has no profile".
delete from auth.users
where email like 'probe%@netsight.lv';

-- ---------------------------------------------------------------- the check
-- Both should return 0.
select count(*) as probe_reports_left
from public.sightings
where note = '[DELETE ME] probe test row' or reporter_name = 'probe';

select count(*) as probe_accounts_left
from public.profiles
where username like 'probe%';
