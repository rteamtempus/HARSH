-- Phase 2 follow-on: briefing audio caching.
-- See FEATURES.md §5.4 "Audio caching": synthesize when the briefing is generated,
-- cache the MP3 in storage, hand the display a path that plays instantly.

set search_path = public;

-- Audio path (storage object key) for the cached synthesis. NULL when TTS is
-- not configured or synthesis failed; the UI falls back to text-only display.
alter table briefings
  add column audio_path text;

-- Storage bucket. Private (signed URLs only) — anon key can't enumerate the
-- bucket; access goes through createSignedUrl().
insert into storage.buckets (id, name, public)
  values ('briefing-audio', 'briefing-audio', false)
  on conflict (id) do nothing;

-- Storage policies: any authenticated user can read briefing audio for their
-- own family. The path convention is "<family_id>/<type>.mp3", so the policy
-- checks the leading segment against family membership.
create policy "briefing audio read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'briefing-audio'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );

-- Writes happen from the generate-briefing edge function using the service-role
-- key, which bypasses RLS — so no INSERT/UPDATE/DELETE policies needed here.
