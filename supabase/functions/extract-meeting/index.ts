// HARSH meeting extraction edge function.
//
// Takes a transcribed meeting and asks Gemini for structured proposals across
// every primitive (list items, events, routines, household facts, context
// notes). Output items match the BrainDumpItem shape so the review UI can hand
// them to BrainDumpService.execute() unchanged.
//
// Audio is deleted after a successful extract (FEATURES.md §4.6: "audio
// deleted after successful transcription; transcript kept indefinitely").

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

// `label` is the single required primary-text field. The portal normalizes
// it back into typed fields (see normalizeWireItem in brain-dump.service.ts) —
// we store the normalized shape here so meeting-review can hand proposals
// straight to BrainDumpService.execute().
// Mirrors the wire ITEM_SCHEMA in projects/data-access/src/lib/brain-dump.service.ts.
// Keep these in sync — the meeting must capture everything the brain dump can.
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'list_item', 'event', 'routine', 'household_fact', 'context_note',
        'waste_event', 'inventory_restock', 'meal_cooked',
      ],
    },
    label: {
      type: 'string',
      description:
        'The primary text. ALWAYS fill this. list_item: item text. event: title. routine: routine name. ' +
        'household_fact: the fact key/name. context_note: the note content. ' +
        'waste_event: the thing wasted. inventory_restock: the item name. meal_cooked: the recipe / meal name.',
    },
    value: { type: 'string', description: 'household_fact only: the fact value.' },
    list_name: { type: 'string', description: 'list_item only.' },
    notes: { type: 'string' },
    deadline: { type: 'string' },
    starts_at: { type: 'string' },
    ends_at: { type: 'string' },
    all_day: { type: 'boolean' },
    location: { type: 'string' },
    category: { type: 'string' },
    cadence_type: { type: 'string', enum: ['interval', 'calendar'] },
    interval_days: { type: 'integer' },
    cadence_rrule: { type: 'string' },
    note_type: {
      type: 'string',
      enum: ['emotional', 'situational', 'privacy_restriction', 'celebration'],
    },
    expires_at: { type: 'string' },
    suppress_topics: { type: 'array', items: { type: 'string' } },
    reason: {
      type: 'string',
      enum: ['spoiled', 'disliked', 'leftover_not_eaten', 'accident', 'not_worth_it', 'other'],
      description: 'waste_event only',
    },
    percentage_wasted: { type: 'integer', description: 'waste_event only: 0-100; 100 = whole item, 50 = half used' },
    quantity_text: { type: 'string', description: 'waste_event only: "half a loaf", "two slices", etc.' },
    estimated_value_cents: { type: 'integer', description: 'waste_event only: when known. Otherwise leave blank.' },
    count: { type: 'integer', description: 'inventory_restock only: explicit count when given ("3 cans of beans").' },
    servings_made: { type: 'integer', description: 'meal_cooked only: number of servings prepared.' },
    estimated_total_cost_cents: { type: 'integer', description: 'meal_cooked only: when a cost is stated.' },
    reasoning: { type: 'string', description: 'Short quote from the transcript that prompted this item.' },
  },
  required: ['type', 'label'],
};

// Mirror of normalizeWireItem from the portal's brain-dump.service. Keeps the
// stored proposals in the typed shape the review UI + executor expect.
function normalizeWireItem(raw: any): any | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = (raw.label ?? '').toString().trim();
  if (!label && raw.type !== 'household_fact') return null;
  const reasoning = raw.reasoning;
  switch (raw.type) {
    case 'list_item':
      return { type: 'list_item', list_name: raw.list_name || 'To Do', text: label, notes: raw.notes, deadline: raw.deadline, reasoning };
    case 'event':
      if (!raw.starts_at) return null;
      return { type: 'event', title: label, starts_at: raw.starts_at, ends_at: raw.ends_at, all_day: raw.all_day, location: raw.location, notes: raw.notes, reasoning };
    case 'routine':
      return { type: 'routine', name: label, category: raw.category, cadence_type: raw.cadence_type === 'calendar' ? 'calendar' : 'interval', interval_days: raw.interval_days, cadence_rrule: raw.cadence_rrule, notes: raw.notes, reasoning };
    case 'household_fact':
      if (!raw.value) return null;
      return { type: 'household_fact', key: label, value: raw.value, category: raw.category, reasoning };
    case 'context_note':
      if (!raw.expires_at) return null;
      return { type: 'context_note', content: label, note_type: raw.note_type ?? 'situational', expires_at: raw.expires_at, suppress_topics: raw.suppress_topics, reasoning };
    case 'waste_event':
      return { type: 'waste_event', name: label, reason: raw.reason ?? 'other', percentage_wasted: raw.percentage_wasted, quantity_text: raw.quantity_text, estimated_value_cents: raw.estimated_value_cents, reasoning };
    case 'inventory_restock':
      return { type: 'inventory_restock', name: label, count: raw.count, reasoning };
    case 'meal_cooked':
      return { type: 'meal_cooked', recipe_name: label, servings_made: raw.servings_made, estimated_total_cost_cents: raw.estimated_total_cost_cents, notes: raw.notes, reasoning };
    default:
      return null;
  }
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1-2 paragraph summary of the meeting in plain language.' },
    proposals: { type: 'array', items: ITEM_SCHEMA },
    open_questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Things discussed but not decided. High-value to surface.',
    },
  },
  required: ['summary', 'proposals', 'open_questions'],
};

const SYSTEM_PROMPT = `You are processing the transcript of a family planning meeting. Extract structured proposals across these primitives:
  - list_item: to-do or grocery items routed to an existing list when possible.
  - event: a specific scheduled time with a real ISO timestamp.
  - routine: a recurring obligation (interval_days OR cadence_rrule).
  - household_fact: durable facts about the household.
  - context_note: time-bounded situational context (expires_at within 30 days).
  - waste_event: ONLY when someone says something was thrown out / discarded / spoiled / expired / not eaten. label = the thing wasted ("moldy bread", "the curry leftovers"). reason = closest of spoiled/disliked/leftover_not_eaten/accident/not_worth_it/other. percentage_wasted 0-100 (default 100; lower for "half-used"/"almost empty"). Do NOT confuse with list_item — "we need bread" is a list_item, "we threw out the bread" is a waste_event.
  - inventory_restock: when someone says they bought / restocked / replaced something the household tracks ("we got more milk", "I picked up bread"). label = the item name. count when explicit.
  - meal_cooked: when someone says they cooked or served a meal ("I made lasagna", "we had spaghetti"). label = the recipe / meal name. servings_made when stated.

Critical rules:
- EVERY proposal MUST have a non-empty "label" (the primary text). For household_fact also set "value".
- NEVER extract emotional processing, jokes, or filler as action items.
- INCLUDE non-actionable content in the summary, briefly and respectfully.
- ALWAYS extract "open questions" — things discussed but not decided. This is the highest-value extraction; missing one wastes the meeting.
- For each proposal, set "reasoning" to a short quote from the transcript that prompted it.
- Resolve relative dates against the meeting's recorded_at timestamp.
- The summary is plain-language, not a list. Two paragraphs max. Don't praise effort or pad with filler.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: { meeting_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.meeting_id) return json({ error: 'meeting_id_required' }, 400);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'missing_gemini_api_key' }, 500);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await admin.from('meeting_notes').update({ status: 'extracting', error_message: null })
    .eq('id', body.meeting_id);

  try {
    const { data: meeting, error: mErr } = await admin
      .from('meeting_notes').select('*, families(name, time_zone, settings)')
      .eq('id', body.meeting_id).single();
    if (mErr || !meeting) throw new Error(`meeting_not_found:${mErr?.message}`);
    if (!meeting.transcript) throw new Error('no_transcript');

    // Fetch lists + members + profiles to feed list_name resolution.
    const [listsRes, membersRes, profilesRes] = await Promise.all([
      admin.from('lists').select('id,name').eq('family_id', meeting.family_id),
      admin.from('family_members').select('id,display_name').eq('family_id', meeting.family_id),
      admin.from('profiles').select('id,name,kind').eq('family_id', meeting.family_id),
    ]);

    const tz = meeting.families?.time_zone ?? 'UTC';
    const recordedAt = meeting.recorded_at;

    const prompt = [
      `Meeting recorded at ${recordedAt} (${tz}).`,
      `Existing lists: ${(listsRes.data ?? []).map((l: any) => l.name).join(', ') || '(none)'}`,
      `Family members: ${(membersRes.data ?? []).map((m: any) => m.display_name).join(', ') || '(none)'}`,
      `Profiles: ${(profilesRes.data ?? []).map((p: any) => `${p.name} (${p.kind})`).join(', ') || '(none)'}`,
      '',
      'Transcript:',
      meeting.transcript,
    ].join('\n');

    const geminiResp = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.3,
          // Summary + many proposals + open questions can exceed 8192 and
          // truncate mid-JSON. Give plenty of headroom.
          maxOutputTokens: 32768,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      throw new Error(`gemini_${geminiResp.status}:${errText.slice(0, 300)}`);
    }
    const data = await geminiResp.json();
    const finish = data?.candidates?.[0]?.finishReason;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (finish && finish !== 'STOP') {
      throw new Error(`extraction_incomplete:finishReason=${finish}`);
    }
    let parsed: { summary: string; proposals: any[]; open_questions: string[] };
    try { parsed = JSON.parse(stripCodeFences(rawText)); }
    catch { throw new Error(`invalid_json_from_model:${rawText.length}chars:${rawText.slice(0, 120)}`); }

    const normalizedProposals = (parsed.proposals ?? [])
      .map(normalizeWireItem)
      .filter((p: any) => p !== null);

    const update: Record<string, unknown> = {
      status: 'ready_for_review',
      proposals: normalizedProposals,
      open_questions: parsed.open_questions,
      ai_summary: parsed.summary,
      error_message: null,
    };
    // Transcript retention is opt-in (meeting_notes.save_transcript, default
    // false). When off, drop the raw transcript + diarized segments now that the
    // proposals + summary are extracted — only the derived artifacts remain.
    // When on, keep the transcript so the owner can re-run extraction / debug.
    if (!meeting.save_transcript) {
      update.transcript = null;
      update.transcript_segments = null;
    }
    await admin.from('meeting_notes').update(update).eq('id', body.meeting_id);

    // Delete the audio now that we've extracted everything — FEATURES.md §4.6
    // privacy posture says transcript kept, audio deleted.
    if (meeting.audio_path) {
      await admin.storage.from('meeting-audio').remove([meeting.audio_path]);
      await admin.from('meeting_notes').update({ audio_path: null }).eq('id', body.meeting_id);
    }

    return json({
      ok: true,
      proposal_count: parsed.proposals.length,
      open_questions_count: parsed.open_questions.length,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from('meeting_notes').update({ status: 'failed', error_message: msg })
      .eq('id', body.meeting_id);
    return json({ error: msg }, 500);
  }
});

// Gemini occasionally wraps JSON in ```json … ``` fences despite
// responseMimeType=application/json. Strip them before parsing.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
