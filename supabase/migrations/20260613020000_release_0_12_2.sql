-- Release 0.12.2: the display PWA now shows the same "new version ready"
-- Reload banner the portal has, so a cached display picks up deploys without
-- clearing site data.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.12.2', '2026-06-13T22:45:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(),
    'improvements', jsonb_build_array(
      'The installed display app now surfaces a "new version is ready — Reload" banner when a deploy lands, matching the portal. No more clearing site data to get the latest code on a long-running display.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
