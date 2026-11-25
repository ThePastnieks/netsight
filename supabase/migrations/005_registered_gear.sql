-- NetSight — registered gear.
--
-- Run in Supabase → SQL Editor → Run. Safe to run again.
--
-- A fisherman registers a net before setting it. The code he gets is what he
-- writes on the buoy; when someone finds that net and reports it, the app says
-- whose it is instead of treating a legal net as abandoned gear.
--
-- Every signed-in account may read the whole table. That is deliberate: a
-- patrol standing over a net needs to know whether it is registered, and a
-- reporter needs to see that the net in front of them belongs to someone.
-- Nothing personal is stored beyond the username that registered it.

create table if not exists public.registered_gear (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,        -- NS-7K3M9P, written on the buoy
  label        text not null,               -- what the owner calls it
  gear_type    text not null default 'net'
                 check (gear_type in ('net', 'trap', 'buoy', 'float')),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  owner_name   text not null,
  span         jsonb,                       -- [[lat,lon],[lat,lon]] for a net
  lat          double precision,            -- midpoint, for a quick lookup
  lon          double precision,
  valid_until  timestamptz,                 -- null means no expiry
  created_at   timestamptz not null default now()
);

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

-- Table privileges. Row level security decides which rows; this decides whether
-- the role may touch the table at all. Both are needed.
grant select, insert, update, delete on public.registered_gear to authenticated;
grant select on public.registered_gear to anon;

-- ============================================================ done
-- Check it worked:
--   select code, label, owner_name from public.registered_gear;
