-- Release-notes pop-up flow (FEATURES.md §9.3).
-- Versioning is global (semver, MAJOR.MINOR.PATCH); acknowledgement is per-user.
-- Pop-up rule: on first app open of a calendar day, show all unread releases batched.

set search_path = public;

create table releases (
  id uuid primary key default gen_random_uuid(),
  -- Sortable semver: zero-padded so plain text sort matches version order.
  -- e.g. "00001.00002.00003"  =  v1.2.3
  version text not null unique,
  released_at timestamptz not null default now(),
  -- Structured notes: { new_features: [...], improvements: [...], fixes: [...] }
  notes jsonb not null default '{"new_features":[],"improvements":[],"fixes":[]}'::jsonb,
  created_at timestamptz not null default now()
);

create index releases_released_idx on releases(released_at desc);

-- Per-user acknowledgement: which release the user has "seen" + last day the pop-up fired.
create table user_release_acks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_version_seen text references releases(version) on delete set null,
  last_popup_shown_on date,
  updated_at timestamptz not null default now()
);

alter table releases          enable row level security;
alter table user_release_acks enable row level security;

-- Releases are globally visible to authenticated users.
create policy releases_select on releases
  for select to authenticated using (true);

-- Acks are strictly per-user.
create policy acks_select on user_release_acks
  for select to authenticated using (user_id = auth.uid());

create policy acks_upsert_insert on user_release_acks
  for insert to authenticated with check (user_id = auth.uid());

create policy acks_upsert_update on user_release_acks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Order key: releases are ranked by released_at (timestamp), not by version string.
-- Avoids the "1.10.0 < 1.9.0" lexicographic trap entirely.

-- Helper: unread releases for the current user, newest first.
create or replace function public.unread_releases()
returns setof releases
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from releases r
    left join user_release_acks a on a.user_id = auth.uid()
    left join releases seen on seen.version = a.last_version_seen
   where seen.released_at is null
      or r.released_at > seen.released_at
   order by r.released_at desc;
$$;

revoke all on function public.unread_releases() from public;
grant execute on function public.unread_releases() to authenticated;

-- Helper: should we show the popup right now? Per §9.3: only on first open of calendar day.
create or replace function public.should_show_release_popup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with my_ack as (
    select last_version_seen, last_popup_shown_on
      from user_release_acks
     where user_id = auth.uid()
  ),
  my_seen as (
    select released_at
      from releases
     where version = (select last_version_seen from my_ack)
  ),
  latest as (
    select max(released_at) as ts from releases
  )
  select
    coalesce((select ts from latest), 'epoch'::timestamptz)
      > coalesce((select released_at from my_seen), 'epoch'::timestamptz)
    and coalesce((select last_popup_shown_on from my_ack), 'epoch'::date) < current_date;
$$;

revoke all on function public.should_show_release_popup() from public;
grant execute on function public.should_show_release_popup() to authenticated;

-- Helper: mark popup shown + acknowledge up to a given version.
create or replace function public.acknowledge_releases(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_release_acks(user_id, last_version_seen, last_popup_shown_on, updated_at)
       values (auth.uid(), p_version, current_date, now())
  on conflict (user_id) do update
       set last_version_seen   = greatest(excluded.last_version_seen, user_release_acks.last_version_seen),
           last_popup_shown_on = current_date,
           updated_at          = now();
end;
$$;

revoke all on function public.acknowledge_releases(text) from public;
grant execute on function public.acknowledge_releases(text) to authenticated;
