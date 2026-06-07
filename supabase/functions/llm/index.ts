// HARSH generic LLM edge function.
//
// Thin proxy to Gemini for general-purpose generation. The intent-classification
// flow has its own function (ai-intent) because it does DB execution server-side;
// this one is a stateless text/structured generator used by briefings, extraction,
// and anything else that just needs Gemini output.
//
// Required Supabase secret:
//   GEMINI_API_KEY
//
// Request body:
//   {
//     prompt: string,
//     system?: string,
//     tier?: 'fast' | 'synthesis',
//     schema?: object,          // when set, requests structured JSON output
//     maxOutputTokens?: number,
//     intentLabel?: string,     // free-text for ai_log debugging
//     family_id?: string        // optional — only used for ai_log attribution
//   }
//
// Response: { data, rawText, modelId, latencyMs }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_SYNTHESIS = 'gemini-2.5-flash';   // bump to pro when synthesis quality matters more than cost

const GEMINI_URL = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  prompt: string;
  system?: string;
  tier?: 'fast' | 'synthesis';
  schema?: unknown;
  maxOutputTokens?: number;
  intentLabel?: string;
  family_id?: string;
  /** Inline images for Vision input. Base64-encoded payloads. */
  images?: Array<{ mime_type: string; data: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const started = Date.now();
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.prompt || typeof body.prompt !== 'string') {
    return json({ error: 'prompt_required' }, 400);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'missing_gemini_api_key' }, 500);

  const model = body.tier === 'synthesis' ? MODEL_SYNTHESIS : MODEL_FAST;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.4,
    maxOutputTokens: body.maxOutputTokens ?? 2048,
  };
  if (body.schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = body.schema;
  }

  const parts: Array<Record<string, unknown>> = [{ text: body.prompt }];
  if (body.images?.length) {
    for (const img of body.images) {
      if (!img?.data || !img?.mime_type) continue;
      parts.push({ inline_data: { mime_type: img.mime_type, data: img.data } });
    }
  }
  const geminiBody: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
  if (body.system) {
    geminiBody.systemInstruction = { role: 'system', parts: [{ text: body.system }] };
  }

  let rawText = '';
  let parsed: unknown = null;
  let error: string | undefined;

  try {
    const resp = await fetch(GEMINI_URL(model, apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
    if (!resp.ok) {
      error = `gemini_${resp.status}`;
      const errText = await resp.text();
      console.error('gemini error', resp.status, errText);
    } else {
      const data = await resp.json();
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      // Surface a truncation/empty case explicitly — these are the usual causes
      // of a "model returned nothing" hard error on the client.
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (!rawText) {
        error = finishReason === 'MAX_TOKENS' ? 'response_truncated_max_tokens' : 'empty_model_response';
      } else if (body.schema) {
        const cleaned = stripCodeFences(rawText);
        try { parsed = JSON.parse(cleaned); }
        catch { error = 'invalid_json_from_model'; }
      } else {
        parsed = rawText;
      }
    }
  } catch (e) {
    error = `fetch_failed:${(e as Error).message}`;
  }

  const latencyMs = Date.now() - started;

  // Best-effort ai_log entry. Skipped silently if we have no family_id (no FK target).
  if (body.family_id) {
    try {
      const authHeader = req.headers.get('Authorization') ?? '';
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      await supabase.from('ai_log').insert({
        family_id: body.family_id,
        surface: 'portal',
        transcript: body.intentLabel ?? body.prompt.slice(0, 200),
        parsed_intent: { tier: body.tier ?? 'fast', has_schema: !!body.schema },
        result: error ? null : { rawText: rawText.slice(0, 4000) },
        error: error ?? null,
        latency_ms: latencyMs,
      });
    } catch (logErr) {
      console.error('ai_log insert failed', logErr);
    }
  }

  if (error) return json({ error, latencyMs }, 500);

  return json({
    data: parsed,
    rawText,
    modelId: model,
    latencyMs,
  });
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
