-- NetSight — case decisions and the conversation.
--
-- Run in Supabase → SQL Editor → Run. Safe to run again.
--
-- Two things a report needs before anyone can act on it: a decision, and a way
-- to ask the reporter a question. A report with neither is just a pin on a map.

-- ---------------------------------------------------------------- decisions
--
-- severity      set when the patrol accepts; how urgent it is
-- verdict       accepted / declined / null while undecided
-- decline_reason why it was closed without action — a bottle, a legal net,
--                nothing there any more
--
-- All nullable: a brand new report has decided nothing yet.

alter table public.sightings
  add column if not exists severity text
    check (severity in ('critical', 'high', 'medium', 'low')),
  add column if not exists verdict text
    check (verdict in ('accepted', 'declined')),
  add column if not exists decline_reason text
    check (decline_reason in ('not_gear', 'legal', 'already_gone', 'duplicate', 'outside')),
  add column if not exists handled_by text,
  add column if not exists handled_at timestamptz;

create index if not exists idx_sightings_severity on public.sightings(severity);
create index if not exists idx_sightings_verdict on public.sightings(verdict);

-- -------------------------------------------------------------- conversation
--
-- A reporter says "there is a net by the bridge". The patrol asks "which side?"
-- and the answer decides whether anybody drives out. Without this the only
-- options are guess or ignore.

create table if not exists public.case_messages (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.sightings(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  author_name  text not null,
  author_role  text not null check (author_role in ('user', 'patrol', 'admin')),
  body         text not null check (length(body) between 1 and 1000),
  created_at   timestamptz not null default now()
);

create index if not exists idx_messages_case on public.case_messages(case_id, created_at);

alter table public.case_messages enable row level security;

-- Everyone signed in reads the thread: the reporter needs to see the reply, and
-- patrol needs the context.
drop policy if exists "read case messages" on public.case_messages;
create policy "read case messages" on public.case_messages
  for select using (auth.role() = 'authenticated');

-- You may only speak as yourself.
drop policy if exists "write own messages" on public.case_messages;
create policy "write own messages" on public.case_messages
  for insert with check (auth.uid() = author_id);

-- Patrol and admin may remove a message; a reporter may remove their own.
drop policy if exists "delete messages" on public.case_messages;
create policy "delete messages" on public.case_messages
  for delete using (
    public.is_admin()
    or public.my_role() = 'patrol'
    or author_id = auth.uid()
  );

grant select, insert, update, delete on public.case_messages to authenticated;
grant select on public.case_messages to anon;

-- ============================================================ done
-- Check it worked:
--   select severity, verdict, decline_reason from public.sightings limit 1;
--   select * from public.case_messages limit 1;
