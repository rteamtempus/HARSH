-- Google Calendar OAuth — extends calendar_accounts to store OAuth tokens.
--
-- The `calendar_account_kind` enum already has 'google'. The bookkeeping
-- columns here are populated by the gcal-oauth-exchange Edge Function and
-- read by sync-gcal / gcal-push.
--
-- Token storage: plain text in DB columns. Acceptable because (a) RLS limits
-- reads to the family that owns the row, (b) only edge functions running
-- with service-role touch these columns, and (c) the OAuth scope is limited
-- to calendar.events. If we ever expand scope (e.g. Gmail) we should switch
-- to pgsodium-encrypted columns or Supabase Vault — flagged in CAVEATS.md.

set search_path = public;

alter table calendar_accounts
  add column oauth_access_token   text,
  add column oauth_refresh_token  text,
  add column oauth_expires_at     timestamptz,
  -- Google calendar id, e.g. 'primary' or 'someone@group.calendar.google.com'.
  -- One row per (family, kind, external_calendar_id, member).
  add column external_calendar_id text,
  -- Incremental-sync cursor (Google's syncToken). NULL = next sync is a full pull.
  add column sync_token            text;

-- Prevent the same Google calendar being connected twice for a family.
-- (member_id can differ — two adults can each connect their own copy of the
-- shared family calendar if they want.)
create unique index calendar_accounts_unique_external
  on calendar_accounts(family_id, kind, external_calendar_id, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where external_calendar_id is not null;
