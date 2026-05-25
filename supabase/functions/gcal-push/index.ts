// HARSH Google Calendar push: writes a HARSH event TO Google.
//
// Called after a HARSH-native event is created or updated, when the family
// has a connected Google calendar. Picks the family's primary google account
// (member's own if available, otherwise any in the family), and inserts /
// updates the corresponding Google event.
//
// Request body: { event_id: string }
// Response: { google_event_id, account_id }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  let body: { event_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.event_id) return json({ error: 'event_id_required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // RLS-gated read so the caller can only push their own family's events.
  const { data: event, error: evErr } = await userClient
    .from('events').select('*').eq('id', body.event_id).single();
  if (evErr || !event) return json({ error: 'event_not_found' }, 404);

  // Only push HARSH-native events (source='manual' or 'voice'). Events already
  // sourced from a calendar account are read-only here; pushing them back
  // would create echoing loops.
  if (event.source_account_id) {
    return json({ skipped: true, reason: 'event_already_has_source_account' });
  }

  // Pick the gcal account to push to. Prefer the event's owner_member_id's
  // account; fall back to any gcal account in the family.
  let accountQuery = admin
    .from('calendar_accounts').select('*')
    .eq('family_id', event.family_id).eq('kind', 'google');
  const { data: accounts, error: accErr } = await accountQuery;
  if (accErr) return json({ error: `accounts_read:${accErr.message}` }, 500);
  if (!accounts || accounts.length === 0) {
    return json({ skipped: true, reason: 'no_google_account_connected' });
  }
  const account = accounts.find((a) => a.member_id === event.owner_member_id) ?? accounts[0];

  try {
    const accessToken = await ensureFreshAccessToken(admin, account);
    const calId = encodeURIComponent(account.external_calendar_id ?? 'primary');

    const gcalEvent = buildGcalEventBody(event);

    let url: string;
    let method: string;
    if (event.external_id) {
      // Update existing google event
      url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(event.external_id)}`;
      method = 'PATCH';
    } else {
      url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`;
      method = 'POST';
    }

    const gResp = await fetch(url, {
      method,
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(gcalEvent),
    });
    if (!gResp.ok) {
      const text = await gResp.text();
      throw new Error(`google_push_${gResp.status}:${text.slice(0, 200)}`);
    }
    const gData = await gResp.json() as { id: string };

    // Save the google event id so future updates patch instead of insert.
    if (!event.external_id) {
      await admin.from('events').update({
        external_id: gData.id,
        source_account_id: account.id,
        source: 'gcal',
      }).eq('id', event.id);
    }

    return json({ google_event_id: gData.id, account_id: account.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function buildGcalEventBody(event: any) {
  const body: any = {
    summary: event.title,
    description: event.notes ?? undefined,
    location: event.location ?? undefined,
  };
  if (event.all_day) {
    const startDate = (event.starts_at as string).slice(0, 10);
    const endDate = event.ends_at ? (event.ends_at as string).slice(0, 10) : startDate;
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    body.start = { dateTime: event.starts_at };
    body.end = { dateTime: event.ends_at ?? event.starts_at };
  }
  return body;
}

async function ensureFreshAccessToken(admin: any, account: any): Promise<string> {
  const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;
  if (account.oauth_access_token && expiresAt - Date.now() > 60_000) return account.oauth_access_token;
  if (!account.oauth_refresh_token) throw new Error('no_refresh_token_stored');

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('missing_google_oauth_credentials');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: account.oauth_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`token_refresh_${resp.status}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  await admin.from('calendar_accounts').update({
    oauth_access_token: data.access_token,
    oauth_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('id', account.id);
  return data.access_token;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
