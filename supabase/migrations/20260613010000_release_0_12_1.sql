-- Release 0.12.1: the display app is now phone-friendly and installable as a
-- PWA, so it can be tested remotely and added to a phone home screen alongside
-- the portal.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.12.1', '2026-06-13T22:30:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'The display can now be installed to a phone home screen as its own app (next to the portal). On the display URL, use your browser''s "Add to Home Screen" — it opens full-screen with its own icon.'
    ),
    'improvements', jsonb_build_array(
      'The display is now usable on a phone, not just a TV. On narrow screens it collapses to a single scrolling column instead of clipping the wall layout, so you can check the briefing, lists, and calendar from your hand.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
