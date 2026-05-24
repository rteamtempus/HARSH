-- Phase 4: meeting scribe.
-- See FEATURES.md §4.6 — record planning meetings, transcribe, extract proposals,
-- review + commit through the same path brain-dump uses.
--
-- Privacy posture (§4.6): transcript is kept; audio is deleted after successful
-- extraction (the extract-meeting function nulls audio_path and deletes the
-- storage object). Status field drives the state machine in the UI.

set search_path = public;

create type meeting_status as enum (
  'recording',          -- client-side only; no row exists yet
  'uploaded',           -- audio in storage, no transcript
  'transcribing',       -- transcription job in progress
  'transcribed',        -- transcript ready, extraction not yet run
  'extracting',         -- extraction job in progress
  'ready_for_review',   -- proposals available, awaiting human confirm
  'committed',          -- items applied via brain-dump executor
  'failed'              -- terminal error (see error_message)
);

create table meeting_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  duration_seconds int,
  -- markers user dropped during the meeting: [{ at_seconds, label }]
  markers jsonb not null default '[]'::jsonb,

  -- Storage path while audio is alive (e.g. "<family_id>/<meeting_id>.webm").
  -- Nulled by extract-meeting after a successful run.
  audio_path text,

  -- Transcription output.
  transcript text,
  transcript_segments jsonb,  -- [{ start_ms, end_ms, text, speaker_label }]

  -- Extraction output.
  -- proposals is BrainDumpItem[] (same shape brain-dump uses).
  proposals jsonb not null default '[]'::jsonb,
  -- Questions discussed but not decided — surfaced separately from action items.
  open_questions text[] not null default '{}',
  -- 1-2 paragraph AI summary of the meeting.
  ai_summary text,

  status meeting_status not null default 'uploaded',
  committed_at timestamptz,
  error_message text,
  created_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index meeting_notes_family_recorded_idx on meeting_notes(family_id, recorded_at desc);
create index meeting_notes_status_idx on meeting_notes(family_id, status);

alter table meeting_notes enable row level security;

create policy meeting_notes_select on meeting_notes
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy meeting_notes_insert on meeting_notes
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy meeting_notes_update on meeting_notes
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy meeting_notes_delete on meeting_notes
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

-- Realtime so the UI can watch status transitions live.
alter publication supabase_realtime add table meeting_notes;

-- Storage bucket for meeting audio. Private; audio uploaded by the family,
-- read+deleted by the edge functions. Path convention: <family_id>/<meeting_id>.<ext>
insert into storage.buckets (id, name, public)
  values ('meeting-audio', 'meeting-audio', false)
  on conflict (id) do nothing;

-- Authenticated users can upload + read + delete audio for their own family.
-- (Extract function deletes via service-role; this policy lets the client
-- abort an upload and clean up too.)
create policy "meeting audio insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );

create policy "meeting audio read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );

create policy "meeting audio delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );
