-- NetSight — zone rules and official gear.
--
-- Run in Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Two ideas, one file.
--
-- 1. A permitted zone is not always "50 m in from the bank". Some water is a
--    channel where the legal strip is the band along the shore — from the bank
--    out to 50 m, and no further. So each drawn shape carries its own rule.
--
-- 2. A net registered by Water Patrol or an administrator is official gear. It
--    carries an owner who is accountable for it, and a report near it is not a
--    case. Nets registered by anyone else are ordinary registrations.

-- ------------------------------------------------------------- zone rules
--
-- rule       inward  — at least distance_m inside the bank (the original rule)
--            band    — within distance_m of the bank, and no further
--            inside  — anywhere inside the shape, no distance rule
--
-- distance_m is metres. 50 by default, the old hard-coded value.

alter table public.shore_shapes
  add column if not exists rule text not null default 'inward'
    check (rule in ('inward', 'band', 'inside')),
  add column if not exists distance_m integer not null default 50
    check (distance_m >= 0 and distance_m <= 2000);

-- Existing rows keep the behaviour they already had: inward, 50 m.

-- ------------------------------------------------------------ official gear
--
-- Set at registration from the owner's role, not chosen by the client. A patrol
-- registering a net is asserting it is theirs to look after.

alter table public.registered_gear
  add column if not exists official boolean not null default false;

create index if not exists idx_gear_official on public.registered_gear(official);

-- Backfill: anything already registered by a patrol or admin account becomes
-- official. This is the only place the role is read after the fact, and it is
-- a one-time correction, not an ongoing rule.
update public.registered_gear g
set official = true
from public.profiles p
where g.owner_id = p.id
  and p.role in ('patrol', 'admin')
  and g.official = false;

-- ============================================================ done
-- Check it worked:
--   select name, rule, distance_m from public.shore_shapes;
--   select code, owner_name, official from public.registered_gear;
