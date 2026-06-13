-- Release 0.12.3: fix the display showing a blank screen on a fresh device.
-- The display's wall-mode text colors are tuned for a dark canvas, but the app
-- defaulted to the light theme — light text on a light background, i.e.
-- invisible. The display now defaults to dark unless a theme was explicitly
-- chosen.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.12.3', '2026-06-13T23:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array(
      'Fixed the display appearing blank on a phone or freshly opened device. It was defaulting to the light theme, where the display''s text colors (made for a dark TV) were invisible on the light background. The display now opens in dark mode by default; you can still switch to light from the display menu.'
    )
  ))
on conflict (version) do nothing;
