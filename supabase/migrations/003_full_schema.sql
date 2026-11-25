-- NetSight — the whole database, in one migration.
--
-- Run this once in Supabase → SQL Editor → New query → Run.
--
-- What it creates:
--   profiles       one row per account, holding the username and the role
--   shore_shapes   the hand-drawn shoreline
--   devices        the buoy fleet
--   sightings      already existed; this adds `span` and the missing policies
--   storage        a bucket for sighting photos
--
-- Roles: user / patrol / admin. The first account to sign up becomes admin;
-- everyone after that is a user until an admin promotes them.
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

-- A policy on profiles that reads profiles recurses forever. This helper runs
-- as the definer, so it can look without triggering the policy again.
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

alter table public.profiles enable row level security;

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

-- The profile row is created by this trigger, not by the client. That way a
-- new account cannot choose its own role.
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

  select exists (select 1 from public.profiles) into first;

  -- Two people may not claim the same name; the trigger resolves the clash
  -- rather than failing the whole signup.
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

-- ========================================================== shore_shapes
create table if not exists public.shore_shapes (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('polygon', 'circle', 'freehand')),
  name        text not null,
  coords      jsonb,                    -- [[lat,lon], …] for polygon / freehand
  lat         double precision,         -- circle centre
  lon         double precision,
  radius      double precision,         -- circle radius, metres
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.shore_shapes enable row level security;

-- Everyone signed in needs to see the shoreline: it decides where they may
-- report. Only an admin may change it.
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

alter table public.devices enable row level security;

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

-- ============================================================== sightings
-- 001_initial_schema.sql created this. These are the additions it needs now.

alter table public.sightings
  add column if not exists span jsonb,
  add column if not exists reported_by uuid references public.profiles(id) on delete set null,
  add column if not exists reporter_name text;

create index if not exists idx_sightings_reported_by on public.sightings(reported_by);

drop policy if exists "Public read sightings" on public.sightings;
drop policy if exists "Authenticated insert sightings" on public.sightings;
drop policy if exists "Inspector update sightings" on public.sightings;

-- Anyone signed in may see sightings: the map is the product.
drop policy if exists "read sightings" on public.sightings;
create policy "read sightings" on public.sightings
  for select using (auth.role() = 'authenticated');

-- You may only create a sighting as yourself.
drop policy if exists "insert own sightings" on public.sightings;
create policy "insert own sightings" on public.sightings
  for insert with check (auth.uid() = reported_by);

-- Patrol and admin move cases along. A plain user may still edit their own.
drop policy if exists "update sightings" on public.sightings;
create policy "update sightings" on public.sightings
  for update using (
    public.is_admin()
    or public.my_role() = 'patrol'
    or reported_by = auth.uid()
  );

drop policy if exists "delete sightings" on public.sightings;
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
alter publication supabase_realtime add table public.sightings;
alter publication supabase_realtime add table public.shore_shapes;
