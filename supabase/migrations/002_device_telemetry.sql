-- Telemetry posted by the buoys. One row per report; the app reads the latest
-- row per device. See netlify/functions/telemetry.js.

create table if not exists device_telemetry (
  id             bigserial primary key,
  device_id      text        not null,
  nfc            text,
  recorded_at    timestamptz not null default now(),
  lat            double precision not null,
  lon            double precision not null,
  battery        smallint,
  temperature_c  real,
  water_level_cm real,
  tilt_lifted    boolean     not null default false,
  tilt_degrees   real,
  light_on       boolean,
  signal         smallint,
  created_at     timestamptz not null default now()
);

create index if not exists device_telemetry_device_time
  on device_telemetry (device_id, recorded_at desc);

-- The most recent report per buoy.
create or replace view device_latest as
select distinct on (device_id) *
from device_telemetry
order by device_id, recorded_at desc;

alter table device_telemetry enable row level security;

-- Anyone may post telemetry (a buoy has no user session); reading is staff only.
create policy "telemetry insert" on device_telemetry
  for insert with check (true);

create policy "telemetry read staff" on device_telemetry
  for select using (auth.role() = 'authenticated');
