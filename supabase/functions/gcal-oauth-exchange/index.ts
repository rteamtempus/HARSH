// HARSH Google Calendar OAuth code-exchange edge function.
//
// Receives the authorization code from the portal's /auth/google/callback
// route, exchanges it with Google for access + refresh tokens, and creates a
// `calendar_accounts` row for the user's primary calendar.
//
// Required Supabase secrets:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//
// Request body:
//   {
//     code: string,                  // ?code= param from the Google redirect
//     redirect_uri: string,          // must match the one used to start the flow
//     name?: string,                 // optional display name for the row
//     color?: string,
//   }
//
// Response: { calendar_account_id, external_calendar_id, email }

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

  let body: { code?: string; redirect_uri?: string; name?: string; color?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.code || !body.redirect_uri) return json({ error: 'code_and_redirect_uri_required' }, 400);

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'missing_google_oauth_credentials' }, 500);

  // Step 1: exchange the auth code for tokens.
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: body.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: body.redirect_uri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    return json({ error: `google_token_${tokenResp.status}`, details: errText.slice(0, 300) }, 502);
  }
  const tokens = await tokenResp.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
  if (!tokens.refresh_token) {
    // Google omits refresh_token on subsequent grants for the same client. If
    // this happens the user previously authorised and didn't fully revoke.
    return json({
      error: 'no_refresh_token',
      hint: 'Revoke HARSH at https://myaccount.google.com/permissions then reconnect.',
    }, 400);
  }

  // Step 2: grab the user's email + primary calendar id with the access token.
  const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'authorization': `Bearer ${tokens.access_token}` },
  });
  if (!userinfoResp.ok) {
    return json({ error: 'google_userinfo_failed' }, 502);
  }
  const userinfo = await userinfoResp.json() as { email: string; name?: string };

  // Step 3: identify the family. Use the caller's JWT to resolve via RLS.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: meRow, error: meErr } = await userClient
    .from('family_members').select('id, family_id').limit(1).maybeSingle();
  if (meErr || !meRow) return json({ error: 'family_member_not_found' }, 400);

  // Step 4: upsert the calendar_accounts row using service role (we need to
  // write tokens that the user's RLS would also allow, but bypassing keeps
  // this single source of truth and lets us write to columns that aren't in
  // the user-facing API).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const externalCalendarId = 'primary';

  const upsert = await admin
    .from('calendar_accounts')
    .upsert(
      {
        family_id: meRow.family_id,
        member_id: meRow.id,
        kind: 'google',
        name: body.name ?? `Google · ${userinfo.email}`,
        color: body.color ?? '#4f7a9a',
        external_calendar_id: externalCalendarId,
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_expires_at: expiresAt,
        last_sync_status: 'pending',
      },
      { onConflict: 'family_id,kind,external_calendar_id,member_id', ignoreDuplicates: false },
    )
    .select('*')
    .single();
  if (upsert.error) {
    return json({ error: `upsert:${upsert.error.message}` }, 500);
  }

  return json({
    calendar_account_id: upsert.data.id,
    external_calendar_id: externalCalendarId,
    email: userinfo.email,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
