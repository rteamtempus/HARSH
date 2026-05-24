-- Invitations + calendar accounts.
--
-- 1) claim_invitations(): when a user signs in, link any family_member rows
--    where invited_email = their auth email and user_id IS NULL.
-- 2) calendar_accounts: external calendars a family connects (ICS URL today,
--    Google OAuth and CalDAV later).
-- 3) source_account_id on events: which calendar account an event came from
--    (or NULL for manually-entered HARSH-native events).

-- =====================================================================
-- 1) Invitation claim
-- =====================================================================

create or replace function public.claim_invitations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  email text := lower((auth.jwt() ->> 'email'));
  claimed int := 0;
begin
  if uid is null or email is null then
    return 0;
  end if;
  update family_members
     set user_id = uid,
         invited_email = null
   where user_id is null
     and lower(invited_email) = email;
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

revoke all on function public.claim_invitations() from public;
grant execute on function public.claim_invitations() to authenticated;

-- Allow family owners to invite members (insert a row with invited_email but no user_id).
-- The existing family_members_self_insert policy already permits owners to insert,
-- but for clarity we'll also make sure owners can update invited_email.

-- =====================================================================
-- 2) calendar_accounts
-- =====================================================================

create type calendar_account_kind as enum ('ics', 'google', 'caldav');

create table calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid references family_members(id) on delete set null,
  kind calendar_account_kind not null,
  name text not null,
  color text not null default '#717744',
  -- ICS / public-share URL (for kind='ics' or for fallback ICS export of any source).
  ics_url text,
  -- OAuth refresh token / CalDAV password — base64 of an encrypted value (added later).
  -- For now we leave it null and encryption pattern (pgsodium/Vault) is set up
  -- when we wire Google OAuth.
  credentials_encrypted text,
  -- Bookkeeping
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default now()
);

create index calendar_accounts_family_idx on calendar_accounts(family_id);

alter table calendar_accounts enable row level security;

create policy calendar_accounts_select on calendar_accounts
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy calendar_accounts_insert on calendar_accounts
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy calendar_accounts_update on calendar_accounts
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy calendar_accounts_delete on calendar_accounts
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

alter publication supabase_realtime add table calendar_accounts;

-- =====================================================================
-- 3) Tie events to their source account
-- =====================================================================

alter table events
  add column source_account_id uuid references calendar_accounts(id) on delete cascade;

create index events_source_account_idx on events(source_account_id);

-- Replace event_source enum to include the new kinds. (Adding values to an
-- enum requires committing each addition outside a transaction; safer to swap.)
alter type event_source rename to event_source_old;
create type event_source as enum ('manual', 'gcal', 'icloud', 'ics', 'caldav', 'voice');
alter table events
  alter column source drop default,
  alter column source type event_source using source::text::event_source,
  alter column source set default 'manual'::event_source;
drop type event_source_old;
