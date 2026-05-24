-- Phase 1 follow-on:
--   1) Routine action RPCs (complete / skip / snooze / pause / resume) that log history
--      and advance next_due atomically — see FEATURES.md §4.3.
--   2) Add polymorphic assignee to events so profiles (kids, pets) can own events too.

set search_path = public;

-- =========================================================================
-- 1) Events polymorphic assignee
-- =========================================================================
-- `events` already has `owner_member_id`. Add `assignee_profile_id` and a
-- mutual-exclusion check so an event is owned by at most one entity. We keep
-- `owner_member_id` (rather than renaming) to avoid breaking the existing
-- event service.

alter table events
  add column assignee_profile_id uuid references profiles(id) on delete set null,
  add constraint events_single_assignee
    check (owner_member_id is null or assignee_profile_id is null);

-- =========================================================================
-- 2) Routine cadence math helpers
-- =========================================================================

-- Default lead time (in days) for a routine, when lead_time_days is null.
-- Heuristic from FEATURES.md §4.3 "Surfacing Rules": shorter cadences = shorter lead.
create or replace function public.routine_default_lead_days(p_routine routines)
returns int
language sql
immutable
as $$
  select case
    when p_routine.cadence_type = 'interval' then
      case
        when p_routine.interval_days <= 7  then 1
        when p_routine.interval_days <= 30 then 3
        when p_routine.interval_days <= 90 then 7
        else 14
      end
    -- calendar cadence: harder to infer; default to 3-day surface window.
    else 3
  end;
$$;

-- Compute the next due date AFTER a given anchor for an interval-cadence routine.
-- For calendar-cadence (rrule), we don't expand rrules in Postgres — the caller
-- (or a scheduled function with an rrule library) sets next_due directly. To keep
-- things working today, calendar routines just leave next_due unchanged on complete
-- unless the caller passes p_next_due; a future migration can plug in rrule parsing.
create or replace function public.routine_advance_next_due(
  p_routine_id uuid,
  p_anchor timestamptz default now(),
  p_explicit_next_due timestamptz default null
) returns timestamptz
language plpgsql
as $$
declare
  r routines%rowtype;
  computed timestamptz;
begin
  select * into r from routines where id = p_routine_id for update;
  if not found then
    raise exception 'routine % not found', p_routine_id;
  end if;

  if p_explicit_next_due is not null then
    computed := p_explicit_next_due;
  elsif r.cadence_type = 'interval' then
    computed := p_anchor + make_interval(days => r.interval_days);
  else
    -- calendar cadence — we don't expand rrules here. Leave next_due as-is.
    computed := r.next_due;
  end if;

  update routines set next_due = computed where id = r.id;
  return computed;
end;
$$;

revoke all on function public.routine_advance_next_due(uuid, timestamptz, timestamptz) from public;
grant execute on function public.routine_advance_next_due(uuid, timestamptz, timestamptz) to authenticated;

-- =========================================================================
-- 3) Routine action RPCs
-- =========================================================================
-- Each action is atomic: writes to routine_history and updates routines in one
-- transaction. RLS already restricts these to family members because the helper
-- queries pass through family_id.

-- Complete: log completion, advance next_due.
create or replace function public.routine_complete(
  p_routine_id uuid,
  p_member_id uuid default null,
  p_note text default null,
  p_next_due timestamptz default null   -- caller can override (e.g. rrule expansion done client-side)
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  r routines%rowtype;
  new_next timestamptz;
begin
  select * into r from routines where id = p_routine_id;
  if not found then raise exception 'routine % not found', p_routine_id; end if;
  if not (r.family_id in (select public.current_user_family_ids())) then
    raise exception 'forbidden';
  end if;

  insert into routine_history(routine_id, family_id, status, by_member_id, note)
    values (p_routine_id, r.family_id, 'completed', p_member_id, p_note);

  new_next := public.routine_advance_next_due(p_routine_id, now(), p_next_due);
  return new_next;
end;
$$;

-- Skip: like complete but logs status='skipped'. Still advances next_due.
create or replace function public.routine_skip(
  p_routine_id uuid,
  p_member_id uuid default null,
  p_note text default null,
  p_next_due timestamptz default null
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  r routines%rowtype;
  new_next timestamptz;
begin
  select * into r from routines where id = p_routine_id;
  if not found then raise exception 'routine % not found', p_routine_id; end if;
  if not (r.family_id in (select public.current_user_family_ids())) then
    raise exception 'forbidden';
  end if;

  insert into routine_history(routine_id, family_id, status, by_member_id, note)
    values (p_routine_id, r.family_id, 'skipped', p_member_id, p_note);

  new_next := public.routine_advance_next_due(p_routine_id, now(), p_next_due);
  return new_next;
end;
$$;

-- Snooze: push next_due forward N days. Does NOT advance the cadence anchor —
-- "try again tomorrow", not "skip this instance".
create or replace function public.routine_snooze(
  p_routine_id uuid,
  p_days int default 1,
  p_member_id uuid default null,
  p_note text default null
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  r routines%rowtype;
  new_next timestamptz;
begin
  if p_days < 1 then raise exception 'snooze days must be >= 1'; end if;

  select * into r from routines where id = p_routine_id for update;
  if not found then raise exception 'routine % not found', p_routine_id; end if;
  if not (r.family_id in (select public.current_user_family_ids())) then
    raise exception 'forbidden';
  end if;

  new_next := coalesce(r.next_due, now()) + make_interval(days => p_days);

  insert into routine_history(routine_id, family_id, status, by_member_id, snooze_until, note)
    values (p_routine_id, r.family_id, 'snoozed', p_member_id, new_next::date, p_note);

  update routines set next_due = new_next where id = p_routine_id;
  return new_next;
end;
$$;

-- Pause: routine suspended until a date. Doesn't surface during pause.
-- Auto-resumes when pause_until passes (briefing query filters on it).
create or replace function public.routine_pause(
  p_routine_id uuid,
  p_until date,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r routines%rowtype;
begin
  if p_until <= current_date then raise exception 'pause_until must be in the future'; end if;

  select * into r from routines where id = p_routine_id;
  if not found then raise exception 'routine % not found', p_routine_id; end if;
  if not (r.family_id in (select public.current_user_family_ids())) then
    raise exception 'forbidden';
  end if;

  update routines
     set pause_until = p_until,
         pause_reason = p_reason
   where id = p_routine_id;
end;
$$;

-- Resume: clear the pause. Routine surfaces again immediately.
create or replace function public.routine_resume(p_routine_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r routines%rowtype;
begin
  select * into r from routines where id = p_routine_id;
  if not found then raise exception 'routine % not found', p_routine_id; end if;
  if not (r.family_id in (select public.current_user_family_ids())) then
    raise exception 'forbidden';
  end if;

  update routines set pause_until = null, pause_reason = null where id = p_routine_id;
end;
$$;

revoke all on function public.routine_complete(uuid, uuid, text, timestamptz) from public;
revoke all on function public.routine_skip(uuid, uuid, text, timestamptz) from public;
revoke all on function public.routine_snooze(uuid, int, uuid, text) from public;
revoke all on function public.routine_pause(uuid, date, text) from public;
revoke all on function public.routine_resume(uuid) from public;

grant execute on function public.routine_complete(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.routine_skip(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.routine_snooze(uuid, int, uuid, text) to authenticated;
grant execute on function public.routine_pause(uuid, date, text) to authenticated;
grant execute on function public.routine_resume(uuid) to authenticated;
