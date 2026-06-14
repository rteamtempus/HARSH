-- Release 0.13.1: fix weekly meeting failing with "malformed JSON".
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.13.1', '2026-06-14T23:30:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array(
      'Fixed the weekly meeting failing with a malformed-JSON error. The transcription/extraction could be cut off on longer meetings (token limit) and the model''s response wasn''t being cleaned before parsing. Raised the limits and hardened parsing. Also added a "Retry transcription" button so a failed meeting can be re-run without re-recording (the audio is preserved on failure).'
    )
  ))
on conflict (version) do nothing;
