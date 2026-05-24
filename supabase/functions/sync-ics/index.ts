// HARSH sync-ics edge function
//
// Fetches a calendar account's ICS URL, parses VEVENTs, and upserts them into
// the `events` table. Uses the family's IANA time zone for floating-time
// conversion and respects the TZID parameter when present.

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody { calendar_account_id: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return json({ error: 'missing authorization' }, 401);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!body.calendar_account_id) return json({ error: 'calendar_account_id required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );

  const { data: account, error: accErr } = await supabase
    .from('calendar_accounts')
    .select('*')
    .eq('id', body.calendar_account_id)
    .single();
  if (accErr || !account) return json({ error: 'account not found', detail: accErr?.message }, 404);

  const { data: family, error: famErr } = await supabase
    .from('families')
    .select('time_zone')
    .eq('id', account.family_id)
    .single();
  if (famErr || !family) return json({ error: 'family not found', detail: famErr?.message }, 404);
  const familyTz = (family.time_zone as string) || 'UTC';

  let url = (account.ics_url as string | null)?.trim() ?? '';
  if (!url) {
    await markError(supabase, account.id, 'no ics_url set');
    return json({ error: 'account has no ics_url' }, 400);
  }
  if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);

  let ics: string;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'HARSH-FamilyCalendar/0.1' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    ics = await res.text();
    if (!ics.includes('BEGIN:VCALENDAR')) {
      throw new Error(`feed didn't look like iCalendar (first 80 chars: ${ics.slice(0, 80)})`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    await markError(supabase, account.id, `fetch: ${msg}`);
    return json({ error: 'fetch failed', detail: msg }, 502);
  }

  let parsed: ParsedEvent[];
  try {
    parsed = parseIcs(ics, familyTz);
  } catch (e) {
    const msg = (e as Error).message;
    await markError(supabase, account.id, `parse: ${msg}`);
    return json({ error: 'parse failed', detail: msg }, 422);
  }

  const { data: existing, error: existingErr } = await supabase
    .from('events')
    .select('id, external_id')
    .eq('source_account_id', account.id);
  if (existingErr) {
    await markError(supabase, account.id, `select existing: ${existingErr.message}`);
    return json({ error: 'db read failed', detail: existingErr.message }, 500);
  }

  const existingByExternal = new Map<string, string>();
  for (const row of existing ?? []) {
    if (row.external_id) existingByExternal.set(row.external_id, row.id);
  }
  const feedUids = new Set(parsed.map((p) => p.uid));

  const toDelete: string[] = [];
  for (const [uid, id] of existingByExternal) {
    if (!feedUids.has(uid)) toDelete.push(id);
  }
  let deleted = 0;
  if (toDelete.length > 0) {
    const { error } = await supabase.from('events').delete().in('id', toDelete);
    if (!error) deleted = toDelete.length;
  }

  let inserted = 0;
  let updated = 0;
  const errors: Array<{ uid: string; error: string }> = [];

  for (const ev of parsed) {
    const row = {
      family_id: account.family_id,
      title: ev.summary || '(no title)',
      starts_at: ev.start,
      ends_at: ev.end ?? null,
      all_day: ev.allDay,
      location: ev.location ?? null,
      notes: ev.description ?? null,
      owner_member_id: account.member_id,
      source: 'ics',
      external_id: ev.uid,
      source_account_id: account.id,
    };

    const existingId = existingByExternal.get(ev.uid);
    if (existingId) {
      const { error } = await supabase.from('events').update(row).eq('id', existingId);
      if (error) errors.push({ uid: ev.uid, error: error.message });
      else updated++;
    } else {
      const { error } = await supabase.from('events').insert(row);
      if (error) errors.push({ uid: ev.uid, error: error.message });
      else inserted++;
    }
  }

  const status = errors.length === 0 ? 'ok' : 'partial';
  await supabase
    .from('calendar_accounts')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: errors.length > 0 ? `${errors.length} row errors: ${errors[0].error}` : null,
    })
    .eq('id', account.id);

  return json({ inserted, updated, deleted, parsed: parsed.length, errors, family_tz: familyTz });
});

async function markError(supabase: any, id: string, message: string) {
  await supabase
    .from('calendar_accounts')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: message.slice(0, 500),
    })
    .eq('id', id);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// =====================================================================
// ICS parser with IANA tz support
// =====================================================================

interface ParsedEvent {
  uid: string;
  summary: string;
  start: string;   // ISO UTC
  end?: string;    // ISO UTC
  allDay: boolean;
  location?: string;
  description?: string;
}

function parseIcs(text: string, familyTz: string): ParsedEvent[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const ln of raw) {
    if (ln.startsWith(' ') || ln.startsWith('\t')) lines[lines.length - 1] += ln.slice(1);
    else lines.push(ln);
  }

  const events: ParsedEvent[] = [];
  let current: Partial<ParsedEvent> & { _allDay?: boolean } | null = null;
  let inEvent = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; inEvent = true; continue; }
    if (line === 'END:VEVENT') {
      if (current?.uid && current?.start) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? '',
          start: current.start,
          end: current.end,
          allDay: !!current._allDay,
          location: current.location,
          description: current.description,
        });
      }
      current = null;
      inEvent = false;
      continue;
    }
    if (!inEvent || !current) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = head.split(';');
    const params = Object.fromEntries(
      paramParts.map((p) => {
        const i = p.indexOf('=');
        return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
      })
    );

    switch (name) {
      case 'UID': current.uid = value; break;
      case 'SUMMARY': current.summary = unescapeIcs(value); break;
      case 'DESCRIPTION': current.description = unescapeIcs(value); break;
      case 'LOCATION': current.location = unescapeIcs(value); break;
      case 'DTSTART':
      case 'DTEND': {
        const tz = params['TZID'] || undefined;
        const isDate = params['VALUE'] === 'DATE' || /^\d{8}$/.test(value);
        const iso = icsToIso(value, tz, familyTz);
        if (name === 'DTSTART') {
          current.start = iso;
          current._allDay = isDate;
        } else {
          current.end = iso;
        }
        break;
      }
    }
  }
  return events;
}

/**
 * Convert an ICS DTSTART/DTEND value to a UTC ISO string.
 * - "20260523"           → all-day; store noon UTC of that date so it lands on
 *                          the right calendar day in any tz west of London.
 *                          (The display layer filters by `all_day` and uses
 *                          the date portion, not the time.)
 * - "20260523T130000Z"   → already UTC.
 * - "20260523T130000"    → floating; interpret in TZID (or familyTz fallback).
 */
function icsToIso(value: string, tzid: string | undefined, familyTz: string): string {
  // Date-only: midday UTC sidesteps timezone shifting for typical use.
  if (/^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString();
  }
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
    const hh = +value.slice(9, 11), mm = +value.slice(11, 13), ss = +value.slice(13, 15);
    return new Date(Date.UTC(y, m - 1, d, hh, mm, ss)).toISOString();
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
    const hh = +value.slice(9, 11), mm = +value.slice(11, 13), ss = +value.slice(13, 15);
    const tz = tzid || familyTz || 'UTC';
    return zonedWallTimeToUtc(y, m, d, hh, mm, ss, tz).toISOString();
  }
  return value;
}

/**
 * Given wall-clock components in an IANA time zone, return the UTC instant.
 * Uses Intl to compute the zone offset at that wall time (handles DST).
 */
function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, mn: number, s: number, tz: string): Date {
  // Naive: pretend the wall time is UTC.
  const naive = new Date(Date.UTC(y, m - 1, d, h, mn, s));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const g = (t: string) => +(parts.find((p) => p.type === t)?.value ?? '0');
  const reflected = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') === 24 ? 0 : g('hour'), g('minute'), g('second'));
  const offsetMs = reflected - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
