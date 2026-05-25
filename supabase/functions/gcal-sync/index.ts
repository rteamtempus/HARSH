// HARSH Google Calendar pull-sync.
//
// Fetches events from a connected Google calendar (calendar_account.kind='google')
// and upserts them into the events table. Refreshes the OAuth access token if
// it's expired before making the call.
//
// Request body: { calendar_account_id: string }
// Response: { synced: number }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: { calendar_account_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.calendar_account_id) return json({ error: 'calendar_account_id_required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: account, error: accErr } = await admin
    .from('calendar_accounts').select('*').eq('id', body.calendar_account_id).single();
  if (accErr || !account) return json({ error: 'account_not_found' }, 404);
  if (account.kind !== 'google') return json({ error: 'wrong_account_kind', kind: account.kind }, 400);

  try {
    const accessToken = await ensureFreshAccessToken(admin, account);

    const timeMin = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    const calId = encodeURIComponent(account.external_calendar_id ?? 'primary');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
      + `&singleEvents=true&orderBy=startTime&maxResults=250`;

    const gResp = await fetch(url, {
      headers: { 'authorization': `Bearer ${accessToken}` },
    });
    if (!gResp.ok) {
      const text = await gResp.text();
      throw new Error(`google_events_${gResp.status}:${text.slice(0, 200)}`);
    }
    const gData = await gResp.json() as { items: GoogleEvent[] };

    // Replace-all sync: delete events previously imported from this account,
    // then insert the fresh set. Simpler than per-event upsert with the
    // existing schema (no compound unique on source_account_id+external_id).
    // Local HARSH-native events (source_account_id = null) are untouched.
    await admin.from('events').delete().eq('source_account_id', account.id);

    const rows = (gData.items ?? [])
      .filter((e) => e.status !== 'cancelled' && (e.start?.dateTime || e.start?.date))
      .map((e) => mapToEventRow(e, account));

    if (rows.length > 0) {
      const ins = await admin.from('events').insert(rows);
      if (ins.error) throw new Error(`insert:${ins.error.message}`);
    }

    await admin.from('calendar_accounts').update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'ok',
      last_sync_error: null,
    }).eq('id', account.id);

    return json({ synced: rows.length });
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from('calendar_accounts').update({
      last_sync_status: 'error', last_sync_error: msg,
    }).eq('id', account.id);
    return json({ error: msg }, 500);
  }
});

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function mapToEventRow(e: GoogleEvent, account: any) {
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const startsAt = e.start?.dateTime ?? `${e.start?.date}T00:00:00`;
  const endsAt = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : null);
  return {
    family_id: account.family_id,
    title: e.summary ?? '(untitled)',
    starts_at: new Date(startsAt).toISOString(),
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    all_day: allDay,
    location: e.location ?? null,
    notes: e.description ?? null,
    source: 'gcal',
    source_account_id: account.id,
    external_id: e.id,
    owner_member_id: account.member_id ?? null,
  };
}

/**
 * Returns a valid access token, refreshing it (and persisting the new one)
 * if the stored expiry is within 60 seconds.
 */
async function ensureFreshAccessToken(admin: any, account: any): Promise<string> {
  const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;
  const now = Date.now();
  if (account.oauth_access_token && expiresAt - now > 60_000) return account.oauth_access_token;
  if (!account.oauth_refresh_token) throw new Error('no_refresh_token_stored');

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('missing_google_oauth_credentials');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.oauth_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`token_refresh_${resp.status}:${text.slice(0, 200)}`);
  }
  const data = await resp.json() as { access_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await admin.from('calendar_accounts').update({
    oauth_access_token: data.access_token,
    oauth_expires_at: newExpiresAt,
  }).eq('id', account.id);
  return data.access_token;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
