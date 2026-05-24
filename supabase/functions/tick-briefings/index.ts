// HARSH scheduled briefing tick.
//
// Called by pg_cron (or any other scheduler) to regenerate briefings for every
// family. Iterates `families`, fans out to generate-briefing for each.
//
// Required Supabase secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-set by platform)
//   CRON_SECRET — shared secret matched against the X-Cron-Secret header on
//                 incoming requests. Generate with `openssl rand -hex 32` and
//                 set both here AND in the pg_cron call.
//
// Request body:
//   { type?: 'daily' | 'weekly' | 'monthly' }   // default 'daily'
//
// Response: { ok: true, families: number, errors: [...] }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Shared-secret auth. Don't rely on Supabase JWT — pg_cron isn't a user.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { type?: 'daily' | 'weekly' | 'monthly' } = {};
  try { body = await req.json(); } catch { /* default ok */ }
  const type = body.type ?? 'daily';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: families, error } = await admin.from('families').select('id');
  if (error) return json({ error: `families_read:${error.message}` }, 500);

  const errors: Array<{ family_id: string; error: string }> = [];
  let okCount = 0;

  for (const fam of families ?? []) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-briefing`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Service-role bearer so generate-briefing can read this family's data
          // even though there's no end-user JWT in the cron context.
          'authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ family_id: fam.id, type }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        errors.push({ family_id: fam.id, error: `${resp.status}: ${errText.slice(0, 200)}` });
      } else {
        okCount++;
      }
    } catch (e) {
      errors.push({ family_id: fam.id, error: (e as Error).message });
    }
  }

  return json({ ok: true, families: okCount, errors, type });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
