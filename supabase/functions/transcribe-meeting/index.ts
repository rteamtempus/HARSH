// HARSH meeting transcription edge function.
//
// Downloads the meeting audio from storage, sends it to Gemini 2.5 Flash as
// inline base64, asks for a diarized transcript with timestamps. Updates the
// meeting_notes row with the transcript + segments and advances status.
//
// Cap: Gemini accepts up to ~20MB inline. For meetings beyond that (about 25
// minutes at typical webm/opus compression), this function will fail with a
// clear error; the next stage is Google STT long-running operations via the
// TranscriptionAdapter pattern.
//
// Required secrets: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

const MAX_INLINE_BYTES = 19 * 1024 * 1024;     // ~19MB to stay under Gemini's 20MB inline cap

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string', description: 'Full transcript, plain text with speaker labels inline.' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_ms: { type: 'integer' },
          end_ms: { type: 'integer' },
          text: { type: 'string' },
          speaker_label: { type: 'string', description: 'Speaker A / Speaker B / etc.' },
        },
        required: ['start_ms', 'end_ms', 'text'],
      },
    },
  },
  required: ['transcript', 'segments'],
};

const SYSTEM_PROMPT = `You are a transcription assistant for a family planning meeting. Transcribe the audio verbatim. Identify distinct speakers and label them Speaker A, Speaker B, etc. Provide timestamps for each segment. Do not summarize or interpret — that's a downstream step.`;

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

  // Mark transcribing.
  await admin.from('meeting_notes').update({ status: 'transcribing', error_message: null })
    .eq('id', body.meeting_id);

  try {
    const { data: meeting, error: mErr } = await admin
      .from('meeting_notes').select('*').eq('id', body.meeting_id).single();
    if (mErr || !meeting) throw new Error(`meeting_not_found:${mErr?.message}`);
    if (!meeting.audio_path) throw new Error('no_audio_path');

    const { data: blob, error: dlErr } = await admin.storage
      .from('meeting-audio')
      .download(meeting.audio_path);
    if (dlErr || !blob) throw new Error(`audio_download:${dlErr?.message}`);

    const arrayBuf = await blob.arrayBuffer();
    if (arrayBuf.byteLength > MAX_INLINE_BYTES) {
      throw new Error(`audio_too_large_for_gemini_inline:${arrayBuf.byteLength}b > ${MAX_INLINE_BYTES}b`);
    }
    const audioB64 = arrayBufferToBase64(arrayBuf);
    const mime = blob.type || 'audio/webm';

    const geminiResp = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this family planning meeting. Identify distinct speakers and timestamp segments.' },
            { inline_data: { mime_type: mime, data: audioB64 } },
          ],
        }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: TRANSCRIPT_SCHEMA,
        },
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      throw new Error(`gemini_${geminiResp.status}:${errText.slice(0, 300)}`);
    }
    const data = await geminiResp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: { transcript: string; segments: any[] };
    try { parsed = JSON.parse(rawText); }
    catch { throw new Error('invalid_json_from_model'); }

    await admin.from('meeting_notes').update({
      status: 'transcribed',
      transcript: parsed.transcript,
      transcript_segments: parsed.segments,
      error_message: null,
    }).eq('id', body.meeting_id);

    return json({ ok: true, transcript_preview: parsed.transcript.slice(0, 500), segment_count: parsed.segments.length });
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from('meeting_notes').update({ status: 'failed', error_message: msg })
      .eq('id', body.meeting_id);
    return json({ error: msg }, 500);
  }
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Chunked to avoid call-stack overflow on large buffers.
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(out);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
