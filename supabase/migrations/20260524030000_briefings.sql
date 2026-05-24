-- Phase 2: briefings.
-- See FEATURES.md §4.5. Pre-computed + cached; display reads from this table.
-- Regeneration triggers (scheduled or event-driven) replace the row for a given
-- (family_id, type) via upsert.

set search_path = public;

create type briefing_type as enum ('daily', 'weekly', 'monthly');

create table briefings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  type briefing_type not null,
  -- Structured content; shape evolves with the prompt. v1 keys (see BriefingContent in data-access):
  --   { hero, today_shape[], needs_attention[], right_now[], heads_up[], positive_reinforcement? }
  content jsonb not null default '{}'::jsonb,
  -- Plain-text rendering for TTS / text-only display. Computed during generation.
  spoken_text text,
  generated_at timestamptz not null default now(),
  -- Hash of the canonical input snapshot; used by future skip-if-unchanged logic.
  source_data_hash text,
  -- Provenance: which model produced this, plus latency for ai_log debugging.
  model text,
  latency_ms int,
  created_at timestamptz not null default now(),
  -- One current briefing per (family, type). Regeneration upserts.
  unique (family_id, type)
);

create index briefings_family_type_idx on briefings(family_id, type);

alter table briefings enable row level security;

create policy briefings_select on briefings
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));

create policy briefings_insert on briefings
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));

create policy briefings_update on briefings
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));

create policy briefings_delete on briefings
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

-- Briefings are real-time-relevant: the display app subscribes and re-renders
-- whenever a regeneration writes a new row.
alter publication supabase_realtime add table briefings;
