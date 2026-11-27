-- Removes everything demo_data.sql created. Test data only.
delete from public.sightings where id::text like 'de000000-0000-4000-8000-%';   -- cascades messages and votes
delete from public.registered_gear where code like 'NS-DEMO%';
delete from public.shore_shapes where name like '%(demo, from OpenStreetMap)%';
