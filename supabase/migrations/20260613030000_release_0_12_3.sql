-- Release 0.12.3: fix the display showing a blank screen.
-- Root cause: the board injects BrainDumpService (for the shared voice Q&A),
-- which requires the LLM adapter, but the display app never registered that
-- provider (only the portal did). Constructing the board threw a dependency-
-- injection error (NG0201), so the board never rendered. Fixed by providing
-- the LLM adapter in the display app, mirroring the portal.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.12.3', '2026-06-13T23:10:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array(
      'Fixed the display showing a blank screen after sign-in. The display was missing a piece of setup the board needs for the "ask the display a question" feature, which stopped the whole board from loading. It now loads correctly on phones and the TV.'
    )
  ))
on conflict (version) do nothing;
