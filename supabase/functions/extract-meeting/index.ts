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

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['list_item', 'event', 'routine', 'household_fact', 'context_note'] },
    list_name: { type: 'string' },
    text: { type: 'string' },
    title: { type: 'string' },
    name: { type: 'string' },
    key: { type: 'string' },
    value: { type: 'string' },
    content: { type: 'string' },
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
    reasoning: { type: 'string', description: 'Short quote from the transcript that prompted this item.' },
  },
  required: ['type'],
};

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

Critical rules:
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
          maxOutputTokens: 8192,
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
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: { summary: string; proposals: any[]; open_questions: string[] };
    try { parsed = JSON.parse(rawText); }
    catch { throw new Error('invalid_json_from_model'); }

    await admin.from('meeting_notes').update({
      status: 'ready_for_review',
      proposals: parsed.proposals,
      open_questions: parsed.open_questions,
      ai_summary: parsed.summary,
      error_message: null,
    }).eq('id', body.meeting_id);

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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
