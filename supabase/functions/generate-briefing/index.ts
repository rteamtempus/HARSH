// HARSH briefing generator edge function — FEATURES.md §4.5.
//
// Assembles a snapshot of family context (events, routines, facts, context notes),
// asks Gemini for a structured briefing, and upserts into the `briefings` table.
//
// Required Supabase secrets:
//   GEMINI_API_KEY
//   SUPABASE_URL, SUPABASE_ANON_KEY    (auto-set by Supabase platform; used to pass
//                                       through the caller's JWT so RLS still applies)
//   SUPABASE_SERVICE_ROLE_KEY          (used ONLY to write the briefing row after
//                                       the read pass — keeps the table writable from
//                                       scheduled jobs too)
//
// Request body:
//   {
//     family_id: string,
//     type?: 'daily' | 'weekly' | 'monthly',   // defaults to 'daily'
//   }
//
// Response: { briefing: BriefingContent, spoken_text, generated_at }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  family_id: string;
  type?: 'daily' | 'weekly' | 'monthly';
}

const BRIEFING_SCHEMA = {
  type: 'object',
  properties: {
    hero: {
      type: 'string',
      description: '1-2 sentence summary the user can absorb at a glance. Concrete and grounded.',
    },
    today_shape: {
      type: 'array',
      items: { type: 'string' },
      description: "Today's events and obligations. One line each. Empty array if nothing today.",
    },
    needs_attention: {
      type: 'array',
      items: { type: 'string' },
      description: 'Deadlines approaching, routines due today/tomorrow, escalated items.',
    },
    right_now: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most 1-2 ambient suggestions. Calm, never imperative.',
      maxItems: 2,
    },
    heads_up: {
      type: 'array',
      items: { type: 'string' },
      description: 'Not-today-but-close: lawn service tomorrow, bill due in 3 days, etc.',
    },
    positive_reinforcement: {
      type: 'string',
      description: 'Weekly/monthly only — meaningful, earned, infrequent. Omit for daily.',
    },
    meal_recap: {
      type: 'string',
      description: 'Weekly/monthly only. ONE short line summarizing meals cooked, total cost, and waste, e.g. "Cooked 6 meals (~$84). About $11 went in the bin." Omit for daily.',
    },
  },
  required: ['hero', 'today_shape', 'needs_attention', 'right_now', 'heads_up'],
};

const SYSTEM_PROMPT = `You write a household briefing for a family — calm, warm, conversational with restraint. Like reading a sticky note from someone who knows the household.

Surfacing rules (FEATURES.md §7.1):
- deadline_tasks come with an "effective_nag" of passive / surface / assertive.
  - assertive: belongs in "needs_attention" with clear language.
  - surface: belongs in "needs_attention" or "heads_up" depending on how soon act_by is.
  - passive: only mention in "heads_up" or skip entirely.
- During quiet hours (current time inside quiet_hours window in family's tz), suppress passive and surface items; only assertive items should be in any section. The briefing as a whole still renders during quiet hours — it just stays calmer and shorter.

Tone rules (non-negotiable):
- No exclamation points.
- No "Have a great day!" filler.
- No participation-trophy praise. No "Great job!"
- No commanding tone. Inform, don't nag.
- For positive reinforcement (weekly/monthly), be specific and earned: "you stayed on top of trash for 4 weeks straight" yes, "amazing work!" no.
- If there is genuinely nothing in a section, return an empty array.
- Honor suppression_topics: if any topic in suppression_topics appears in input data, do NOT mention it in any section during this briefing.
- Apply tone_hints from context notes — if a hint says "supportive, big presentation today", make the hero supportive without overdoing it.

Daily briefing structure:
- hero: 1-2 sentences. The "absorb in 2 seconds" line.
- today_shape: today's events, called out plainly.
- needs_attention: deadlines, routines due, escalated items.
- right_now: at most 1-2 ambient suggestions, contextual.
- heads_up: not-today-but-close items (1-3 days out).
- positive_reinforcement: OMIT for daily.

Weekly briefing:
- hero: this week's shape in one sentence.
- today_shape: heavy/light days this week.
- needs_attention: routines + deadlines landing this week.
- right_now: focus suggestion or empty.
- heads_up: next-week peek.
- positive_reinforcement: ONLY if specifically earned this past week.
- meal_recap: ONE line summarizing meals_cooked, total_cost_cents, and total_wasted_cents from the inputs (when meal_recap input is present). State waste only if non-trivial — under $2 isn't worth mentioning. Sample tone: "Cooked 6 meals (~$84). About $11 went in the bin." Skip the line entirely if no meals were logged.

Monthly briefing:
- hero: month-at-a-glance.
- today_shape: bills + seasonal items for the month.
- needs_attention: recurring obligations.
- right_now: empty or one strategic suggestion.
- heads_up: longer horizon items.
- positive_reinforcement: looking-back summary if warranted.
- meal_recap: monthly version of the same recap line.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const started = Date.now();
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.family_id) return json({ error: 'family_id_required' }, 400);
  const type = body.type ?? 'daily';

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'missing_gemini_api_key' }, 500);

  // Read with caller's JWT so RLS still gates which family they're touching.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // Assemble context snapshot.
  const now = new Date();
  const tzNow = now.toISOString();
  const horizonStart = new Date(now.getTime() - 6 * 3600 * 1000).toISOString();
  const dailyHorizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const weeklyHorizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
  const monthlyHorizon = new Date(now.getTime() + 35 * 24 * 3600 * 1000).toISOString();
  const horizon = type === 'monthly' ? monthlyHorizon : type === 'weekly' ? weeklyHorizon : dailyHorizon;

  // Recap window: 7 days for weekly, 30 days for monthly. We compute the recap
  // server-side so the model only formats the line — keeps the numbers exact.
  const recapDays = type === 'monthly' ? 30 : 7;
  const recapStart = new Date(now.getTime() - recapDays * 24 * 3600 * 1000).toISOString();

  const [familyRes, eventsRes, routinesRes, factsRes, notesRes, deadlinesRes, mealsRes, wasteRes] = await Promise.all([
    userClient.from('families').select('*').eq('id', body.family_id).single(),
    userClient.from('events').select('*').eq('family_id', body.family_id)
      .gte('starts_at', horizonStart).lte('starts_at', horizon)
      .order('starts_at', { ascending: true }),
    userClient.from('routines').select('*').eq('family_id', body.family_id).eq('active', true),
    userClient.from('household_facts').select('*').eq('family_id', body.family_id).limit(50),
    userClient.from('weekly_context_notes').select('*').eq('family_id', body.family_id)
      .gt('expires_at', tzNow),
    // Deadline-aware items via the view that exposes effective_nag + act_by.
    userClient.from('list_items_with_act_by').select('*').eq('family_id', body.family_id)
      .eq('checked', false).not('deadline', 'is', null).lte('deadline', horizon)
      .order('deadline', { ascending: true }),
    // Recap inputs for weekly / monthly. Daily fetches them but ignores below.
    userClient.from('meal_events').select('*')
      .eq('family_id', body.family_id)
      .gte('occurred_at', recapStart),
    userClient.from('waste_events').select('*')
      .eq('family_id', body.family_id)
      .gte('occurred_at', recapStart),
  ]);

  if (familyRes.error) return json({ error: `family_read:${familyRes.error.message}` }, 500);
  if (!familyRes.data) return json({ error: 'family_not_found' }, 404);

  const family = familyRes.data;
  const events = eventsRes.data ?? [];
  const routines = routinesRes.data ?? [];
  const facts = factsRes.data ?? [];
  const notes = notesRes.data ?? [];
  const deadlines = deadlinesRes.data ?? [];
  const mealsRecent = mealsRes.data ?? [];
  const wasteRecent = wasteRes.data ?? [];

  // Build the recap numbers. Total cost = sum of estimated_total_cost_cents;
  // total wasted = waste_events.estimated_value_cents PLUS meal_events
  // estimated_value_wasted_cents (the stored generated column). These don't
  // double-count because the meal-derived waste isn't logged into waste_events.
  const mealsCookedCount = mealsRecent.length;
  const totalCostCents = mealsRecent.reduce(
    (s: number, m: any) => s + (m.estimated_total_cost_cents ?? 0), 0,
  );
  const totalWastedCents =
    wasteRecent.reduce((s: number, w: any) => s + (w.estimated_value_cents ?? 0), 0)
    + mealsRecent.reduce((s: number, m: any) => s + (m.estimated_value_wasted_cents ?? 0), 0);
  const wasteEventCount = wasteRecent.length;

  // Quiet hours: when active, briefing should de-emphasize non-assertive items.
  const qh = (family.settings?.quiet_hours ?? {}) as { start?: string; end?: string };
  const quietStart = qh.start ?? '21:00';
  const quietEnd = qh.end ?? '07:00';

  // Distill notes into tone hints and suppression list.
  const suppressionTopics = notes
    .filter((n: any) => n.type === 'privacy_restriction')
    .flatMap((n: any) => n.suppress_topics ?? []);
  const toneHints = notes
    .filter((n: any) => n.type !== 'privacy_restriction')
    .map((n: any) => `(${n.type}) ${n.content}`);

  const tz = family.time_zone ?? 'UTC';
  const todayLocal = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: tz,
  });

  // Routines due window
  const dueWindow = type === 'monthly' ? 35 : type === 'weekly' ? 14 : 3;
  const routinesDue = routines.filter((r: any) => {
    if (!r.next_due) return false;
    if (r.pause_until && new Date(r.pause_until) > now) return false;
    const days = (new Date(r.next_due).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return days <= dueWindow;
  });

  const inputs = {
    type,
    today_local: todayLocal,
    timezone: tz,
    family_name: family.name,
    quiet_hours: { start: quietStart, end: quietEnd },
    events: events.map((e: any) => ({
      title: e.title, starts_at: e.starts_at, ends_at: e.ends_at,
      all_day: e.all_day, location: e.location,
    })),
    routines_due: routinesDue.map((r: any) => ({
      name: r.name, category: r.category,
      next_due: r.next_due, cadence: r.cadence_type === 'interval'
        ? `every ${r.interval_days} days`
        : r.cadence_rrule,
    })),
    // Deadline tasks with auto-escalated nag levels — feed straight in so the
    // model can decide which section to put them in based on effective_nag.
    deadline_tasks: deadlines.map((d: any) => ({
      text: d.text,
      deadline: d.deadline,
      act_by: d.act_by,
      lead_time_minutes: d.lead_time_minutes,
      effective_nag: d.effective_nag,
      notes: d.notes,
    })),
    household_facts: facts.map((f: any) => ({ key: f.key, value: f.value, category: f.category })),
    tone_hints: toneHints,
    suppression_topics: suppressionTopics,
    ...(type === 'daily' ? {} : {
      meal_recap: {
        window_days: recapDays,
        meals_cooked: mealsCookedCount,
        total_cost_cents: totalCostCents,
        total_wasted_cents: totalWastedCents,
        waste_events: wasteEventCount,
      },
    }),
  };

  const prompt = [
    `Generate a ${type} briefing.`,
    `Today is ${todayLocal} (${tz}).`,
    'Context (JSON):',
    JSON.stringify(inputs, null, 2),
  ].join('\n');

  // Gemini call.
  const generationConfig: Record<string, unknown> = {
    temperature: 0.5,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    responseSchema: BRIEFING_SCHEMA,
  };

  const geminiResp = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig,
    }),
  });

  if (!geminiResp.ok) {
    const errText = await geminiResp.text();
    console.error('gemini error', geminiResp.status, errText);
    return json({ error: `gemini_${geminiResp.status}`, details: errText.slice(0, 500) }, 502);
  }

  const data = await geminiResp.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let content: any;
  try { content = JSON.parse(rawText); }
  catch { return json({ error: 'invalid_json_from_model', rawText: rawText.slice(0, 500) }, 502); }

  const spokenText = renderSpoken(content, type);
  const latencyMs = Date.now() - started;

  // Write with service role so this works for both user-triggered and future
  // scheduled (cron) calls. We've already enforced RLS on the read pass.
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Optionally synthesize TTS audio (FEATURES.md §5.4 audio caching).
  // Skipped silently when GOOGLE_CLOUD_API_KEY isn't configured — the UI
  // falls back to text-only display in that case.
  let audioPath: string | null = null;
  const ttsKey = Deno.env.get('GOOGLE_CLOUD_API_KEY');
  if (ttsKey && spokenText) {
    try {
      audioPath = await synthesizeAndUpload(
        adminClient, ttsKey,
        body.family_id, type, spokenText, family.settings?.voice?.voice_id,
      );
    } catch (e) {
      console.error('tts synth failed (continuing without audio):', e);
    }
  }

  const upsertResp = await adminClient
    .from('briefings')
    .upsert(
      {
        family_id: body.family_id,
        type,
        content,
        spoken_text: spokenText,
        audio_path: audioPath,
        generated_at: new Date().toISOString(),
        model: MODEL,
        latency_ms: latencyMs,
      },
      { onConflict: 'family_id,type' },
    )
    .select('*')
    .single();

  if (upsertResp.error) {
    return json({ error: `upsert:${upsertResp.error.message}` }, 500);
  }

  return json({
    briefing: content,
    spoken_text: spokenText,
    audio_path: audioPath,
    generated_at: upsertResp.data.generated_at,
    latency_ms: latencyMs,
  });
});

const DEFAULT_VOICE = 'en-US-Chirp3-HD-Aoede';

async function synthesizeAndUpload(
  client: any,
  apiKey: string,
  familyId: string,
  type: string,
  text: string,
  voiceId: string | undefined,
): Promise<string | null> {
  const voice = voiceId || DEFAULT_VOICE;
  const languageCode = voice.split('-').slice(0, 2).join('-') || 'en-US';
  const ttsResp = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { name: voice, languageCode },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    },
  );
  if (!ttsResp.ok) {
    console.error('google tts non-200', ttsResp.status, await ttsResp.text());
    return null;
  }
  const ttsData = await ttsResp.json();
  if (!ttsData.audioContent) return null;

  // base64 → Uint8Array for storage upload.
  const bin = atob(ttsData.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const path = `${familyId}/${type}.mp3`;
  const upload = await client.storage
    .from('briefing-audio')
    .upload(path, bytes, { contentType: 'audio/mp3', upsert: true });
  if (upload.error) {
    console.error('audio upload failed', upload.error);
    return null;
  }
  return path;
}

function renderSpoken(c: any, type: string): string {
  const parts: string[] = [c.hero ?? ''];
  if (c.today_shape?.length) parts.push('Today: ' + c.today_shape.join('. ') + '.');
  if (c.needs_attention?.length) parts.push('Needs attention: ' + c.needs_attention.join('. ') + '.');
  if (c.right_now?.length) parts.push(c.right_now.join('. '));
  if (c.heads_up?.length) parts.push('Heads up: ' + c.heads_up.join('. ') + '.');
  if (type !== 'daily' && c.meal_recap) parts.push(c.meal_recap);
  if (type !== 'daily' && c.positive_reinforcement) parts.push(c.positive_reinforcement);
  return parts.filter(Boolean).join(' ');
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
