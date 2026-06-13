-- Release 0.12.0: the display speaks in a natural Chirp 3 HD voice with
-- snappier turn-taking and barge-in (Approach A — conversational voice polish).
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.12.0', '2026-06-13T21:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'The display now speaks in the warm Chirp 3 HD voice you choose in Settings instead of the robotic browser voice. It falls back to the browser voice automatically until the cloud voice key is set, so nothing breaks in the meantime.',
      'Barge-in: say "Hey HARSH" again while the display is still talking and it stops mid-sentence to listen. You no longer have to wait for it to finish before giving your next command.'
    ),
    'improvements', jsonb_build_array(
      'Snappier turn-taking on the display — it waits less time after you stop talking before it responds (1.2s, down from 1.8s), so conversations feel more natural.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
