-- NetSight demo data for a TEST project: sample reports, nets, a message and two
-- "gone" votes. Everything is marked so demo_cleanup.sql can remove it.
--
-- Test data only: needs the four test accounts tadmin / tpatrol / tboat1 / tboat2.
-- No shoreline is inserted here. The red 50 m line comes from a shoreline drawn by an
-- administrator (docs/MOBILE.md). These samples sit in the Daugava in Riga (about
-- 56.95-56.99 N, 24.09 E), inside the permitted water of the hand-drawn "augsdaugava"
-- shoreline; every position was checked with the app's own geofence and line rules.
-- If you use another shoreline, regenerate the positions.

delete from public.sightings where id::text like 'de000000-0000-4000-8000-%';
delete from public.registered_gear where code like 'NS-DEMO%';

insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000001', now() - interval '3 hours', now() - interval '3 hours', 56.956, 24.092, 8, 'buoy', 'reported', 'abandoned', 'demo: Orange buoy, no flag', (select id from public.profiles where username = 'tboat2'), 'tboat2', false, null, null);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000002', now() - interval '6 hours', now() - interval '6 hours', 56.9524, 24.094, 8, 'net', 'new', 'abandoned', 'demo: Net without markers', (select id from public.profiles where username = 'tboat2'), 'tboat2', false, null, '[[56.952188,24.092741],[56.952612,24.095259]]'::jsonb);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000003', now() - interval '1 hour', now() - interval '1 hour', 56.9596, 24.09, 8, 'float', 'reported', 'abandoned', 'demo: Float, looks abandoned', (select id from public.profiles where username = 'tboat1'), 'tboat1', false, null, null);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span, severity, verdict, handled_by, handled_at)
values ('de000000-0000-4000-8000-000000000004', now() - interval '20 hours', now() - interval '20 hours', 56.9488, 24.096, 8, 'trap', 'checked', 'abandoned', 'demo: Trap, heavy', (select id from public.profiles where username = 'tboat2'), 'tboat2', false, null, null, 'high', 'accepted', 'tpatrol', now() - interval '2 hours');
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000005', now() - interval '12 hours', now() - interval '12 hours', 56.9632, 24.088, 8, 'buoy', 'new', 'abandoned', 'demo: Small white buoy', (select id from public.profiles where username = 'tboat1'), 'tboat1', false, null, null);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000006', now() - interval '30 hours', now() - interval '30 hours', 56.9668, 24.088, 8, 'net', 'reported', 'hazard', 'demo: Long net across the channel', (select id from public.profiles where username = 'tboat2'), 'tboat2', false, null, '[[56.966588,24.086741],[56.967012,24.089259]]'::jsonb);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000007', now() - interval '8 hours', now() - interval '8 hours', 56.9704, 24.09, 8, 'buoy', 'reported', 'abandoned', 'demo: Buoy that people say is gone', (select id from public.profiles where username = 'tboat2'), 'tboat2', false, null, null);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000008', now() - interval '2 days', now() - interval '2 days', 56.974, 24.09, 8, 'net', 'reported', 'abandoned', 'demo: Registered net (matches NS-DEMO01)', (select id from public.profiles where username = 'tboat1'), 'tboat1', true, 'NS-DEMO01', '[[56.973788,24.088741],[56.974212,24.091259]]'::jsonb);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000009', now() - interval '3 days', now() - interval '3 days', 56.9812, 24.09, 8, 'net', 'resolved', 'abandoned', 'demo: Net taken out by its owner', (select id from public.profiles where username = 'tboat1'), 'tboat1', false, null, null);
insert into public.sightings (id, created_at, updated_at, lat, lon, accuracy_m, user_class, status, report_reason, note, reported_by, reporter_name, registry_match, registry_id, span)
values ('de000000-0000-4000-8000-000000000010', now() - interval '5 hours', now() - interval '5 hours', 56.9848, 24.092, 8, 'buoy', 'reported', 'abandoned', 'demo: Buoy near the channel', (select id from public.profiles where username = 'tadmin'), 'tadmin', false, null, null);

insert into public.registered_gear (code, label, gear_type, owner_id, owner_name, span, lat, lon, valid_until)
values
  ('NS-DEMO01', 'Demo net (tboat1)', 'net', (select id from public.profiles where username = 'tboat1'), 'tboat1', '[[56.973788,24.088741],[56.974212,24.091259]]'::jsonb, 56.974, 24.09, now() + interval '90 days'),
  ('NS-DEMO02', 'Demo trap (tboat2)', 'trap', (select id from public.profiles where username = 'tboat2'), 'tboat2', '[[56.977388,24.088741],[56.977812,24.091259]]'::jsonb, 56.9776, 24.09, now() + interval '90 days');

-- A question from the patrol, so tboat1 sees "Reply waiting" under My reports.
insert into public.case_messages (case_id, author_id, author_name, author_role, body)
values ('de000000-0000-4000-8000-000000000003', (select id from public.profiles where username = 'tpatrol'), 'tpatrol', 'patrol', 'Is it still there?');

-- Two different people near buoy 7 say it is gone: the database closes it (see 008).
insert into public.gear_checks (sighting_id, user_id, user_name, answer, user_lat, user_lon)
values
  ('de000000-0000-4000-8000-000000000007', (select id from public.profiles where username = 'tboat1'), 'tboat1',  'gone', 56.9706, 24.09),
  ('de000000-0000-4000-8000-000000000007', (select id from public.profiles where username = 'tpatrol'), 'tpatrol', 'gone', 56.9704, 24.0902);
