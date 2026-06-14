-- Meeting scribe: opt-in transcript retention.
--
-- Privacy default flips to "don't keep the raw transcript". When
-- save_transcript is false (default), extract-meeting clears transcript +
-- transcript_segments after pulling proposals/summary — only the derived
-- artifacts remain. When true, the transcript is kept so it can be re-run for
-- debugging. Set per-meeting from the Weekly meeting page toggle.

set search_path = public;

alter table meeting_notes
  add column if not exists save_transcript boolean not null default false;

comment on column meeting_notes.save_transcript is
  'Opt-in: keep the raw transcript + segments after extraction. Default false (extract-meeting clears them).';
