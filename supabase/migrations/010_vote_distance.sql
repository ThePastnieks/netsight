-- NetSight — votes must come from near the report; photo names are not listable.
--
-- Run in Supabase → SQL Editor → Run, after 009. Safe to run again.
--
-- 1. "Is it still there?" answers (008) now carry the voter's position. The
--    database measures the distance to the report itself (to the nearest point
--    of a net's line) and refuses an answer from more than 120 m away. The app
--    asks at 50 m; the margin covers GPS error. This does not make cheating
--    impossible (a phone can fake its position) but it stops votes from a sofa
--    by anyone who is not also faking a location.
--
-- 2. Anonymous users could LIST every file name in the photo bucket. Listing now
--    needs a signed-in account. The public image links keep working (the bucket
--    stays public so the website and app show photos unchanged); the names are
--    random UUIDs, so a link is only known to people who can see the report.
--    A fully private bucket with signed URLs is a larger change that also needs
--    the website updated.

-- ================================================================== distance
alter table public.gear_checks
  add column if not exists user_lat double precision,
  add column if not exists user_lon double precision;

create or replace function public.metres_between(
  lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

-- Distance from a point to the segment a-b, in metres (flat approximation, fine
-- at the scale of a net).
create or replace function public.metres_to_segment(
  p_lat double precision, p_lon double precision,
  a_lat double precision, a_lon double precision,
  b_lat double precision, b_lon double precision)
returns double precision
language plpgsql immutable
as $$
declare
  m_lon  double precision := 111320 * cos(radians((a_lat + b_lat) / 2));
  px double precision; py double precision; dx double precision;  dy double precision;
  len_sq double precision; t double precision;
begin
  px := (p_lon - a_lon) * m_lon;  py := (p_lat - a_lat) * 111320;
  dx := (b_lon - a_lon) * m_lon;   dy := (b_lat - a_lat) * 111320;
  len_sq := dx * dx +  dy * dy;
  if len_sq = 0 then return sqrt(px * px + py * py); end if;
  t := greatest(0, least(1, (px * dx + py * dy) / len_sq));
  return sqrt((px - t * dx) ^ 2 + (py - t * dy) ^ 2);
end;
$$;

-- Where is this report? A point, or a line when `span` holds two ends.
create or replace function public.metres_to_sighting(
  s_lat double precision, s_lon double precision, s_span jsonb,
  p_lat double precision, p_lon double precision)
returns double precision
language plpgsql immutable
as $$
begin
  if s_span is not null and jsonb_typeof(s_span) = 'array' and jsonb_array_length(s_span) = 2 then
    return public.metres_to_segment(p_lat, p_lon,
      (s_span -> 0 ->> 0)::double precision, (s_span -> 0 ->> 1)::double precision,
      (s_span -> 1 ->> 0)::double precision, (s_span -> 1 ->> 1)::double precision);
  end if;
  return public.metres_between(p_lat, p_lon, s_lat, s_lon);
end;
$$;

revoke execute on function public.metres_between(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.metres_to_segment(double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.metres_to_sighting(double precision, double precision, jsonb, double precision, double precision) from public, anon, authenticated;

-- 008's before-insert check, now also checking the distance.
create or replace function public.gear_check_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s      public.sightings%rowtype;
  d      double precision;
  max_m  constant double precision := 120;
begin
  select * into s from public.sightings where id = new.sighting_id;
  if not found then
    raise exception 'That report does not exist' using errcode = '23503';
  end if;

  if new.user_lat is null or new.user_lon is null
     or new.user_lat not between -90 and 90 or new.user_lon not between -180 and 180 then
    raise exception 'Your position is needed to answer' using errcode = '23514';
  end if;

  d := public.metres_to_sighting(s.lat, s.lon, s.span, new.user_lat, new.user_lon);
  if d > max_m then
    raise exception 'You are too far from this report to answer (% m)', round(d::numeric)
      using errcode = '23514';
  end if;
  new.distance_m := d;

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

revoke execute on function public.gear_check_before() from public, anon, authenticated;

-- ============================================================== photo listing
drop policy if exists "Public read photos" on storage.objects;
drop policy if exists "Signed-in list photos" on storage.objects;
create policy "Signed-in list photos" on storage.objects
  for select using (bucket_id = 'sightings-photos' and auth.role() = 'authenticated');
