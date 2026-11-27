-- NetSight — the whole database, in one script.
--
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to run again: every statement checks before it creates.
--
-- This file is self-contained on purpose. An earlier version assumed
-- 001_initial_schema.sql had already run and failed with
--   relation "public.sightings" does not exist
-- on a fresh project, which is exactly when someone needs it to just work.
--
-- Order matters: profiles comes before sightings, because sightings.reported_by
-- is a foreign key to it.
--
-- What it creates:
--   profiles       one row per account: username + role
--   sightings      every reported gear item
--   shore_shapes   the hand-drawn shoreline
--   devices        the buoy fleet
--   storage        a bucket for sighting photos
--
-- Roles: user / patrol / admin. The first account to sign up becomes admin;
-- everyone after is a user until an admin promotes them.
--
-- Row level security is on everywhere. Without it the public anon key would let
-- anyone read and delete the whole database.

-- ============================================================ extensions
create extension if not exists "pgcrypto";

-- ============================================================== profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text not null unique,
  role        text not null default 'user' check (role in ('user', 'patrol', 'admin')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);

-- A policy on profiles that reads profiles recurses forever. These helpers run
-- as the definer, so they can look without triggering the policy again.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.my_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- The profile row is created by this trigger, not by the client, so a new
-- account cannot choose its own role. The first account becomes the admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
  taken  boolean;
  first  boolean;
begin
  wanted := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1)
  );

  select not exists (select 1 from public.profiles) into first;

  -- Two people may not claim the same name; resolve the clash rather than
  -- failing the whole signup.
  select exists (select 1 from public.profiles where username = wanted) into taken;
  if taken then
    wanted := wanted || '-' || substr(new.id::text, 1, 4);
  end if;

  insert into public.profiles (id, username, role)
  values (new.id, wanted, case when first then 'admin' else 'user' end);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================== sightings
create table if not exists public.sightings (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  photo_url        text,
  lat              double precision not null,
  lon              double precision not null,
  accuracy_m       integer,
  detected_class   text not null default 'unknown'
                     check (detected_class in ('buoy','float','net','trap','none','unknown')),
  confidence       double precision not null default 0
                     check (confidence >= 0 and confidence <= 1),
  user_class       text not null default 'unknown'
                     check (user_class in ('buoy','float','net','trap','unknown')),
  registry_id      text,
  registry_match   boolean not null default false,
  status           text not null default 'new'
                     check (status in ('new','reported','checked','resolved','false_alarm')),
  report_reason    text
                     check (report_reason in ('unmarked','abandoned','hazard','possibly_illegal','other')),
  inspector_id     text,
  note             text default ''
);

-- Columns added after the first draft. `add column if not exists` makes this
-- safe on a table that already exists from an older run.
alter table public.sightings
  add column if not exists span jsonb,
  add column if not exists reported_by uuid references public.profiles(id) on delete set null,
  add column if not exists reporter_name text;

create index if not exists idx_sightings_status on public.sightings(status);
create index if not exists idx_sightings_created on public.sightings(created_at desc);
create index if not exists idx_sightings_location on public.sightings(lat, lon);
create index if not exists idx_sightings_user_class on public.sightings(user_class);
create index if not exists idx_sightings_registry_match on public.sightings(registry_match);
create index if not exists idx_sightings_reported_by on public.sightings(reported_by);

-- Keep updated_at honest without the client having to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_sightings_updated_at on public.sightings;
create trigger update_sightings_updated_at
  before update on public.sightings
  for each row execute function public.touch_updated_at();

-- ========================================================== shore_shapes
create table if not exists public.shore_shapes (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('polygon', 'circle', 'freehand')),
  name        text not null,
  coords      jsonb,                    -- [[lat,lon], …] for polygon / freehand
  lat         double precision,         -- circle centre
  lon         double precision,
  radius      double precision,         -- circle radius, metres
  -- How far from the bank gear may go. A channel is a band along the shore; a
  -- lake is everything inside it. Both are legitimate, so it is per shape.
  rule        text not null default 'inward'
                check (rule in ('inward', 'band', 'inside')),
  distance_m  integer not null default 50
                check (distance_m >= 0 and distance_m <= 2000),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Adding the rule columns to a database that already has the table.
alter table public.shore_shapes
  add column if not exists rule text not null default 'inward'
    check (rule in ('inward', 'band', 'inside')),
  add column if not exists distance_m integer not null default 50
    check (distance_m >= 0 and distance_m <= 2000);

-- =============================================================== devices
create table if not exists public.devices (
  id              text primary key,        -- NS-000101
  nfc             text,
  label           text not null,
  gear_type       text,
  owner           text,
  lat             double precision,
  lon             double precision,
  span            jsonb,                   -- [[lat,lon],[lat,lon]] for nets
  battery         smallint,
  temperature_c   real,
  water_level_cm  real,
  tilt            jsonb,                   -- { lifted: bool, degrees: number }
  light_on        boolean,
  signal          smallint,
  last_seen       timestamptz,
  registered_at   timestamptz not null default now()
);

create index if not exists idx_devices_last_seen on public.devices(last_seen desc);

-- ======================================================= row level security
alter table public.profiles     enable row level security;
alter table public.sightings    enable row level security;
alter table public.shore_shapes enable row level security;
alter table public.devices      enable row level security;

-- ---- profiles
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles" on public.profiles
  for select using (public.is_admin());

drop policy if exists "update own username" on public.profiles;
create policy "update own username" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

drop policy if exists "admins update roles" on public.profiles;
create policy "admins update roles" on public.profiles
  for update using (public.is_admin());

-- ---- shore_shapes: everyone signed in reads, only admins write
drop policy if exists "read shore" on public.shore_shapes;
create policy "read shore" on public.shore_shapes
  for select using (auth.role() = 'authenticated');

drop policy if exists "admins write shore" on public.shore_shapes;
create policy "admins write shore" on public.shore_shapes
  for insert with check (public.is_admin());

drop policy if exists "admins update shore" on public.shore_shapes;
create policy "admins update shore" on public.shore_shapes
  for update using (public.is_admin());

drop policy if exists "admins delete shore" on public.shore_shapes;
create policy "admins delete shore" on public.shore_shapes
  for delete using (public.is_admin());

-- ---- devices: same split
drop policy if exists "read devices" on public.devices;
create policy "read devices" on public.devices
  for select using (auth.role() = 'authenticated');

drop policy if exists "admins write devices" on public.devices;
create policy "admins write devices" on public.devices
  for insert with check (public.is_admin());

drop policy if exists "admins update devices" on public.devices;
create policy "admins update devices" on public.devices
  for update using (public.is_admin());

drop policy if exists "admins delete devices" on public.devices;
create policy "admins delete devices" on public.devices
  for delete using (public.is_admin());

-- ---- sightings
drop policy if exists "Public read sightings" on public.sightings;
drop policy if exists "Authenticated insert sightings" on public.sightings;
drop policy if exists "Inspector update sightings" on public.sightings;
drop policy if exists "read sightings" on public.sightings;
drop policy if exists "insert own sightings" on public.sightings;
drop policy if exists "update sightings" on public.sightings;
drop policy if exists "delete sightings" on public.sightings;

-- Anyone signed in may see sightings: the map is the product.
create policy "read sightings" on public.sightings
  for select using (auth.role() = 'authenticated');

-- You may only create a sighting as yourself.
create policy "insert own sightings" on public.sightings
  for insert with check (auth.uid() = reported_by);

-- Patrol and admin move cases along. A plain user may still edit their own.
create policy "update sightings" on public.sightings
  for update using (
    public.is_admin()
    or public.my_role() = 'patrol'
    or reported_by = auth.uid()
  );

create policy "delete sightings" on public.sightings
  for delete using (public.is_admin());

-- ================================================================ storage
insert into storage.buckets (id, name, public)
values ('sightings-photos', 'sightings-photos', true)
on conflict (id) do nothing;

drop policy if exists "Public read photos" on storage.objects;
create policy "Public read photos" on storage.objects
  for select using (bucket_id = 'sightings-photos');

drop policy if exists "Authenticated upload photos" on storage.objects;
create policy "Authenticated upload photos" on storage.objects
  for insert with check (
    bucket_id = 'sightings-photos' and auth.role() = 'authenticated'
  );

drop policy if exists "Owner deletes photos" on storage.objects;
create policy "Owner deletes photos" on storage.objects
  for delete using (
    bucket_id = 'sightings-photos' and owner = auth.uid()
  );

-- ============================================================== realtime
-- So a sighting reported on one phone appears on another without a refresh.
-- Adding a table twice raises an error, hence the guard.
do $$
begin
  begin
    alter publication supabase_realtime add table public.sightings;
  exception when others then null;
  end;

  begin
    alter publication supabase_realtime add table public.shore_shapes;
  exception when others then null;
  end;
end $$;



-- ========================================================= registered gear
--
-- A fisherman registers a net before setting it; the code he gets is what he
-- writes on the buoy. When someone reports that net, the app can say whose it
-- is instead of treating a legal net as abandoned gear.
--
-- Every signed-in account may read it: a patrol standing over a net needs to
-- know whether it is registered, and a reporter needs to see the owner.

create table if not exists public.registered_gear (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  label        text not null,
  gear_type    text not null default 'net'
                 check (gear_type in ('net', 'trap', 'buoy', 'float')),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  owner_name   text not null,
  span         jsonb,
  lat          double precision,
  lon          double precision,
  valid_until  timestamptz,
  official     boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.registered_gear
  add column if not exists official boolean not null default false;

create index if not exists idx_gear_owner on public.registered_gear(owner_id);
create index if not exists idx_gear_code on public.registered_gear(code);
create index if not exists idx_gear_location on public.registered_gear(lat, lon);

alter table public.registered_gear enable row level security;

drop policy if exists "read registered gear" on public.registered_gear;
create policy "read registered gear" on public.registered_gear
  for select using (auth.role() = 'authenticated');

drop policy if exists "register own gear" on public.registered_gear;
create policy "register own gear" on public.registered_gear
  for insert with check (auth.uid() = owner_id);

drop policy if exists "update own gear" on public.registered_gear;
create policy "update own gear" on public.registered_gear
  for update using (auth.uid() = owner_id or public.is_admin());

drop policy if exists "delete own gear" on public.registered_gear;
create policy "delete own gear" on public.registered_gear
  for delete using (auth.uid() = owner_id or public.is_admin());
-- ================================================================= grants
--
-- Row level security decides which ROWS a role may touch. Postgres separately
-- decides whether the role may touch the TABLE at all. Tables created here get
-- no table privileges automatically, so without this every request fails with
--   401 {"code":"42501","message":"permission denied for table profiles"}
-- even though the policies are correct.
--
-- Both must pass. The grants are broad on purpose; the policies are what
-- restrict, and every policy below requires auth.uid() or
-- auth.role() = 'authenticated'.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
-- ============================================================ done
-- Check it worked: Table Editor should list profiles, sightings, shore_shapes
-- and devices.




