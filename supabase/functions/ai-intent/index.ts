// HARSH ai-intent edge function
//
// Receives a transcript + context, asks Gemini 2.5 Flash to parse it into
// structured intents, executes those intents server-side against the DB
// (still gated by RLS via the caller's JWT), and logs everything to ai_log.
//
// The model never writes to the DB directly — it only proposes intents.
// All execution happens here so we keep one security boundary.
//
// Required Supabase secrets:
//   GEMINI_API_KEY     — from https://aistudio.google.com/app/apikey
//
// Deploy:
//   supabase functions deploy ai-intent
//   supabase secrets set GEMINI_API_KEY=...
//
// Invoke from the client:
//   supabase.functions.invoke('ai-intent', { body: { transcript, family_id, surface }})

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  transcript: string;
  family_id: string;
  surface: 'portal' | 'display';
  member_id?: string | null;
}

interface IntentBase { confidence?: number }
type Intent =
  | (IntentBase & { action: 'list.add_item'; list: string; text: string })
  | (IntentBase & { action: 'list.check_item'; list: string; text: string })
  | (IntentBase & { action: 'list.remove_item'; list: string; text: string })
  | (IntentBase & { action: 'view.show_list'; list: string; resolved_list_id?: string; resolved_list_name?: string })
  | (IntentBase & { action: 'calendar.show'; view: 'day' | 'week' | 'month'; anchor_date: string })
  | (IntentBase & { action: 'calendar.sync_all' })
  | (IntentBase & { action: 'unknown'; reason: string });

interface ParsedResponse {
  intents: Intent[];
  spoken_reply: string;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list.add_item', 'list.check_item', 'list.remove_item',
              'view.show_list', 'calendar.show', 'calendar.sync_all', 'unknown',
            ],
          },
          list: { type: 'string', description: 'Name or kind of list, e.g. "grocery", "todo", "Groceries"' },
          text: { type: 'string', description: 'Item text. Lowercase, singular when natural.' },
          reason: { type: 'string', description: 'Only for action=unknown' },
          confidence: { type: 'number' },
          resolved_list_id: { type: 'string', description: 'Leave blank — set by server' },
          resolved_list_name: { type: 'string', description: 'Leave blank — set by server' },
          view: { type: 'string', enum: ['day', 'week', 'month'], description: 'Only for calendar.show' },
          anchor_date: { type: 'string', description: 'YYYY-MM-DD. Only for calendar.show. Resolve relative dates to an absolute date.' },
        },
        required: ['action'],
      },
    },
    spoken_reply: {
      type: 'string',
      description: 'Short phrase to read back to the user, e.g. "Added milk to groceries"',
    },
  },
  required: ['intents', 'spoken_reply'],
};

function systemPrompt(
  lists: Array<{ id: string; name: string; kind: string }>,
  today: string
): string {
  const listsBlock = lists.map((l) => `- ${l.name} (kind: ${l.kind})`).join('\n');
  return `You convert short family voice commands into structured intents for a household management app called HARSH.

Today's date is ${today} (YYYY-MM-DD). Use this for ALL relative-date resolution.

Available lists for this family:
${listsBlock}

Available actions:
- list.add_item: add an item to a list. text = the item, list = which list.
- list.check_item: mark an existing item as done.
- list.remove_item: delete an existing item.
- view.show_list: switch which list is being viewed.
- calendar.sync_all: refresh every connected calendar. No fields.
    Examples:
      "sync my calendars" / "refresh the calendars" / "pull in the latest from google" → calendar.sync_all
- calendar.show: switch the calendar view and/or jump to a date.
    Fields: view ('day' | 'week' | 'month'), anchor_date (YYYY-MM-DD).
    Examples:
      "show me my calendar" → view=week, anchor_date=today
      "show me my day" / "today's calendar" → view=day, anchor_date=today
      "show me tomorrow" → view=day, anchor_date=today+1
      "show me yesterday" → view=day, anchor_date=today-1
      "next week" → view=week, anchor_date=today+7
      "this month" → view=month, anchor_date=first of current month
      "next month" → view=month, anchor_date=first of next month
      "show me April" / "show me my April calendar" → view=month, anchor_date=first day of April; if April this year is already past, use next year's April
      "show me April 2025" → view=month, anchor_date=2025-04-01
      "show me June 2027" → view=month, anchor_date=2027-06-01
    When only a view is mentioned without a date, anchor_date = today.
    When only a date/month is mentioned without a view, default view = month for a month/year, day for a specific day, week for "this/next week".
- unknown: anything off-topic or that you can't confidently handle.

Rules:
- When the user says "groceries", "shopping", or names food → grocery list.
- When the user says "todo", "tasks", "remind me", "I need to" → todo list.
- Pick the closest matching list by name or kind. Use the list's "name" (not id) in the "list" field.
- Split conjunctions into separate intents.
- "text" should be the item, not the full phrase.
- For view.show_list, just set "list" and leave text empty.
- For calendar.show, ALWAYS resolve relative dates to YYYY-MM-DD using today (${today}).
- spoken_reply: ONE short sentence acknowledging what you did. No emoji, no flourish.

If you are not confident, prefer action="unknown" over guessing.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startedAt = Date.now();
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'missing authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY not set' }, 500);

  // Caller's JWT — RLS will gate all DB access.
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });

  // Fetch the family's lists so we can ground the model.
  const { data: lists, error: listsErr } = await supabase
    .from('lists')
    .select('id, name, kind')
    .eq('family_id', body.family_id);
  if (listsErr) return json({ error: listsErr.message }, 400);

  // Ask Gemini.
  const today = new Date().toISOString().slice(0, 10);
  let parsed: ParsedResponse;
  try {
    parsed = await callGemini(geminiKey, body.transcript, lists ?? [], today);
  } catch (e) {
    await logAi(supabase, body, null, null, `gemini call failed: ${(e as Error).message}`, startedAt);
    return json({ error: 'gemini call failed', detail: (e as Error).message }, 502);
  }

  // Execute intents.
  const results: Array<{ intent: Intent; ok: boolean; error?: string }> = [];
  for (const intent of parsed.intents) {
    try {
      await executeIntent(supabase, intent, lists ?? [], body);
      results.push({ intent, ok: true });
    } catch (e) {
      results.push({ intent, ok: false, error: (e as Error).message });
    }
  }

  await logAi(supabase, body, parsed, results, null, startedAt);

  return json({ intents: parsed.intents, results, spoken_reply: parsed.spoken_reply });
});

async function callGemini(
  apiKey: string,
  transcript: string,
  lists: Array<{ id: string; name: string; kind: string }>,
  today: string
): Promise<ParsedResponse> {
  const res = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(lists, today) }] },
      contents: [{ role: 'user', parts: [{ text: transcript }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return JSON.parse(text) as ParsedResponse;
}

async function executeIntent(
  supabase: any,
  intent: Intent,
  lists: Array<{ id: string; name: string; kind: string }>,
  body: RequestBody
): Promise<void> {
  if (intent.action === 'unknown') return;

  // calendar.show is client-resolved — no DB writes, no list matching needed.
  if (intent.action === 'calendar.show') return;
  // calendar.sync_all is also client-driven (display calls tick-calendar-sync).
  if (intent.action === 'calendar.sync_all') return;

  const target = matchList(intent.list, lists);
  if (!target) throw new Error(`no list matching "${intent.list}"`);

  if (intent.action === 'view.show_list') {
    // No DB write — resolve the reference and let the client switch its own view.
    (intent as any).resolved_list_id = target.id;
    (intent as any).resolved_list_name = target.name;
    return;
  }

  if (intent.action === 'list.add_item') {
    const { error } = await supabase.from('list_items').insert({
      list_id: target.id,
      family_id: body.family_id,
      text: intent.text,
      added_by_member_id: body.member_id ?? null,
    });
    if (error) throw error;
    return;
  }

  if (intent.action === 'list.check_item' || intent.action === 'list.remove_item') {
    const { data: items, error: e1 } = await supabase
      .from('list_items')
      .select('id, text, checked')
      .eq('list_id', target.id);
    if (e1) throw e1;
    const match = (items ?? []).find(
      (i: any) => i.text.toLowerCase() === intent.text.toLowerCase()
    ) ?? (items ?? []).find((i: any) => i.text.toLowerCase().includes(intent.text.toLowerCase()));
    if (!match) throw new Error(`no item matching "${intent.text}"`);
    if (intent.action === 'list.check_item') {
      const { error } = await supabase
        .from('list_items')
        .update({ checked: true, checked_at: new Date().toISOString() })
        .eq('id', match.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('list_items').delete().eq('id', match.id);
      if (error) throw error;
    }
  }
}

function matchList(
  needle: string,
  lists: Array<{ id: string; name: string; kind: string }>
): { id: string; name: string; kind: string } | null {
  if (!needle) return null;
  const n = needle.toLowerCase();
  return (
    lists.find((l) => l.name.toLowerCase() === n) ??
    lists.find((l) => l.kind.toLowerCase() === n) ??
    lists.find((l) => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase())) ??
    lists.find((l) => l.kind.toLowerCase().includes(n) || n.includes(l.kind.toLowerCase())) ??
    null
  );
}

async function logAi(
  supabase: any,
  body: RequestBody,
  parsed: ParsedResponse | null,
  results: unknown,
  error: string | null,
  startedAt: number
): Promise<void> {
  try {
    await supabase.from('ai_log').insert({
      family_id: body.family_id,
      member_id: body.member_id ?? null,
      surface: body.surface,
      transcript: body.transcript,
      parsed_intent: parsed,
      result: results,
      error,
      latency_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error('ai_log insert failed', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
