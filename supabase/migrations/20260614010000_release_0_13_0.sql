-- Release 0.13.0: weekly meeting upgrades — full capture parity, opt-in
-- transcript retention, and phone-recording hardening.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.13.0', '2026-06-14T20:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'The weekly meeting now captures everything the brain dump can. On top of to-dos, events, routines, facts, and context notes, it now also pulls out waste ("we threw out the moldy bread"), restocks ("I picked up more milk"), and meals cooked ("we made lasagna") from what you talked about.',
      'Transcript privacy toggle: by default the raw meeting transcript is discarded once proposals + summary are extracted (only those derived artifacts are kept, and the audio is deleted). Tick "Save the transcript" before recording if you want to keep it — e.g. to re-run extraction.'
    ),
    'improvements', jsonb_build_array(
      'Phone recording is hardened: the screen is kept awake during a meeting, audio is captured in mono with noise suppression, and a lower bitrate lets a meeting run ~80 minutes within the transcription limit (with a warning as you approach it). You also get a prompt before accidentally navigating away mid-recording.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
