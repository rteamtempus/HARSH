// HARSH scheduled calendar sync.
//
// Called by pg_cron (or a manual ping with the right secret) to refresh every
// calendar account for every family. Iterates calendar_accounts and calls
// sync-ics with service-role auth per row, the same pattern tick-briefings uses.
//
// Required Supabase secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-set)
//   CRON_SECRET — shared with pg_cron; same value the tick-briefings function uses.
//                 If you only set it once project-wide, both functions see it.

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth: either a shared cron secret OR a valid user JWT (so the display's
  // voice command can trigger this too without exposing CRON_SECRET to the client).
  const cronSecret = Deno.env.get('CRON_SECRET');
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const isCronAuthed = !!cronSecret && incomingCronSecret === cronSecret;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!isCronAuthed && !authHeader) return json({ error: 'unauthorized' }, 401);

  let body: { family_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // When called by an authenticated user (display voice command), only sync
  // their own family. When called by cron, sync every family.
  // ICS accounts go to sync-ics; google accounts go to gcal-sync.
  let query = admin.from('calendar_accounts').select('id, family_id, kind').in('kind', ['ics', 'google']);
  if (!isCronAuthed && body.family_id) {
    query = query.eq('family_id', body.family_id);
  }
  const { data: accounts, error } = await query;
  if (error) return json({ error: `accounts_read:${error.message}` }, 500);

  const errors: Array<{ account_id: string; error: string }> = [];
  let okCount = 0;

  for (const acc of accounts ?? []) {
    try {
      // Authorize the inner call with whichever credential we have. For cron,
      // that's the service-role bearer; for a user-triggered call, pass their
      // JWT straight through so RLS still applies on the sync side.
      const innerAuth = isCronAuthed ? `Bearer ${serviceKey}` : authHeader;
      const fn = acc.kind === 'google' ? 'gcal-sync' : 'sync-ics';
      const resp = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': innerAuth },
        body: JSON.stringify({ calendar_account_id: acc.id }),
      });
      if (!resp.ok) {
        errors.push({ account_id: acc.id, error: `${resp.status}: ${(await resp.text()).slice(0, 200)}` });
      } else {
        okCount++;
      }
    } catch (e) {
      errors.push({ account_id: acc.id, error: (e as Error).message });
    }
  }

  return json({ ok: true, synced: okCount, errors });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
