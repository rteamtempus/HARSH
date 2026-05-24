// HARSH text-to-speech edge function.
//
// Thin proxy to Google Cloud Text-to-Speech (Chirp 3 HD). See FEATURES.md §5.4.
// Keeps the GOOGLE_CLOUD_API_KEY server-side; client never sees it.
//
// Required Supabase secret:
//   GOOGLE_CLOUD_API_KEY  — restricted to Cloud TTS + Cloud STT in the GCP console.
//
// Request body:
//   {
//     text: string,                 // plain text OR SSML if ssml=true
//     voiceId: string,              // e.g. "en-US-Chirp3-HD-Aoede"
//     ssml?: boolean,
//     speakingRate?: number,        // 0.25..4.0 (Google clamps)
//   }
//
// Response: { audio: base64, mimeType: "audio/mp3" }
//
// Why base64: Supabase Edge Function `functions.invoke()` returns JSON natively;
// binary streams add complexity. Audio is small (briefings are ~50KB MP3) so the
// base64 overhead is fine. Switch to raw stream if briefings ever get long enough
// to matter.

// @ts-nocheck Deno runtime

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  text: string;
  voiceId: string;
  ssml?: boolean;
  speakingRate?: number;
}

const GOOGLE_TTS_URL = (key: string) =>
  `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.text || !body.voiceId) {
    return json({ error: 'text_and_voiceId_required' }, 400);
  }

  const apiKey = Deno.env.get('GOOGLE_CLOUD_API_KEY');
  if (!apiKey) return json({ error: 'missing_google_cloud_api_key' }, 500);

  // Extract language from voice id: "en-US-Chirp3-HD-Aoede" -> "en-US"
  const languageCode = body.voiceId.split('-').slice(0, 2).join('-') || 'en-US';

  const payload: Record<string, unknown> = {
    input: body.ssml ? { ssml: body.text } : { text: body.text },
    voice: { name: body.voiceId, languageCode },
    audioConfig: {
      audioEncoding: 'MP3',
      ...(body.speakingRate ? { speakingRate: body.speakingRate } : {}),
    },
  };

  try {
    const resp = await fetch(GOOGLE_TTS_URL(apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('google tts error', resp.status, errText);
      return json({ error: `google_${resp.status}`, details: errText.slice(0, 500) }, 502);
    }
    const data = await resp.json();
    if (!data.audioContent) return json({ error: 'missing_audio_content' }, 502);
    return json({ audio: data.audioContent, mimeType: 'audio/mp3' });
  } catch (e) {
    return json({ error: `fetch_failed:${(e as Error).message}` }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
