-- Phase 3: deadline awareness. See FEATURES.md §4.2 and §7.1.
--
-- The data fields already exist on list_items (deadline + lead_time_minutes + nag,
-- added in Phase 1). This migration adds:
--   1. effective_nag(): the nag level after deadline-math auto-escalation.
--   2. list_items_with_act_by: a view that exposes act_by + effective_nag for
--      every item, used by the briefing generator and the portal.
--
-- Auto-escalation rule (§7.1): a `passive` task whose deadline is closer than
-- lead_time_minutes gets temporarily promoted to `surface`; closer than half
-- of that, to `assertive`. `surface` items promote to `assertive` once they
-- cross act_by. Items without a deadline use their configured nag as-is.

set search_path = public;

create or replace function public.effective_nag(
  p_deadline timestamptz,
  p_lead_time_minutes int,
  p_configured nag_level
) returns nag_level
language sql
immutable
as $$
  with windows as (
    select
      p_deadline as deadline,
      coalesce(p_lead_time_minutes, 0) as lead_min,
      extract(epoch from (p_deadline - now())) / 60.0 as mins_remaining
  )
  select case
    when deadline is null then p_configured
    -- Past deadline: always assertive.
    when mins_remaining <= 0 then 'assertive'::nag_level
    -- Within half of lead time: assertive.
    when lead_min > 0 and mins_remaining <= lead_min / 2.0 then 'assertive'::nag_level
    -- Within full lead time: at minimum 'surface'.
    when lead_min > 0 and mins_remaining <= lead_min then
      case p_configured when 'passive' then 'surface'::nag_level else p_configured end
    else p_configured
  end
  from windows;
$$;

revoke all on function public.effective_nag(timestamptz, int, nag_level) from public;
grant execute on function public.effective_nag(timestamptz, int, nag_level) to authenticated;

-- Convenience view. Inherits RLS from the underlying list_items table.
create or replace view public.list_items_with_act_by as
select
  i.*,
  -- act_by is the soft target: when you must act by, given lead time. NULL when
  -- there's no deadline.
  case
    when i.deadline is null then null
    else i.deadline - make_interval(mins => coalesce(i.lead_time_minutes, 0))
  end as act_by,
  public.effective_nag(i.deadline, i.lead_time_minutes, i.nag) as effective_nag
from list_items i;

-- Views in Postgres inherit policies from their base tables when using
-- `security_invoker = true` (PG 15+). Supabase is on 15+.
alter view public.list_items_with_act_by set (security_invoker = true);
