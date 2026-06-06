// HARSH recipe extraction edge function.
//
// Downloads a recipe photo from storage, sends it to Gemini 2.5 Flash as inline
// base64 image, asks for structured ingredient + instruction extraction with
// a per-ingredient price estimate. Persists into recipes + recipe_ingredients.
//
// Required Supabase secrets:
//   GEMINI_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-set)
//
// Request body: { recipe_id: string }
// Response: { ingredients_count, instructions_preview, total_cost_cents }

// @ts-nocheck Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
const MAX_INLINE_BYTES = 19 * 1024 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Recipe name if visible on the photo. Leave empty if no clear title.' },
    servings: { type: 'integer', description: 'Number of servings the recipe yields.' },
    prep_time_minutes: { type: 'integer' },
    cook_time_minutes: { type: 'integer' },
    total_time_minutes: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The ingredient name. Lowercase common form when possible.' },
          quantity: { type: 'number', description: 'Numeric quantity. Omit if "to taste" or similar.' },
          unit: { type: 'string', description: 'cup, tbsp, tsp, oz, lb, g, ml, each, etc.' },
          free_text_amount: { type: 'string', description: 'Only when quantity+unit don\'t fit (to taste, a pinch).' },
          notes: { type: 'string', description: 'Preparation notes: minced, melted, room temp, etc.' },
          estimated_cost_cents: { type: 'integer', description: 'Rough US grocery price for the amount used. 0 if unknown.' },
        },
        required: ['name'],
      },
    },
    instructions: {
      type: 'string',
      description: 'Step-by-step preparation. Numbered list with newlines between steps.',
    },
    total_estimated_cost_cents: {
      type: 'integer',
      description: 'Sum of ingredient costs, or your best total estimate. 0 if you cannot estimate.',
    },
  },
  required: ['ingredients', 'instructions'],
};

const SYSTEM_PROMPT = `You are extracting a recipe from a photo. The photo may show a handwritten note, a recipe card, a magazine clipping, or a screenshot. Your job:
1. Read every ingredient and the amount used.
2. Read the step-by-step instructions.
3. Estimate a rough US grocery cost per ingredient for the amount used (not the full bottle/box). Round to nearest dime. If you genuinely cannot estimate, use 0.
4. Estimate prep / cook / total time if mentioned.
5. Estimate servings if mentioned.

Important:
- Be faithful to the original. Don't invent ingredients or steps that aren't on the photo.
- If you can't read part of it, omit that part rather than guess.
- Use lowercase common ingredient names ("flour", "kosher salt", "low sodium soy sauce") so they match inventory lookups later.
- Instructions should be numbered with newlines between steps.
- Costs are rough orientation, not exact — the family will edit.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: { recipe_id?: string; overwrite_title?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.recipe_id) return json({ error: 'recipe_id_required' }, 400);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'missing_gemini_api_key' }, 500);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // RLS doesn't apply with service role — but we still want to ensure the
  // caller is authorized. Re-check via the user JWT before doing anything.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: rls, error: rlsErr } = await userClient
    .from('recipes').select('id').eq('id', body.recipe_id).maybeSingle();
  if (rlsErr || !rls) return json({ error: 'forbidden_or_not_found' }, 404);

  try {
    const { data: recipe, error: rErr } = await admin
      .from('recipes').select('*').eq('id', body.recipe_id).single();
    if (rErr || !recipe) throw new Error(`recipe_not_found:${rErr?.message}`);
    if (!recipe.photo_path) throw new Error('no_photo_to_extract');

    const { data: blob, error: dlErr } = await admin.storage
      .from('recipe-photos').download(recipe.photo_path);
    if (dlErr || !blob) throw new Error(`photo_download:${dlErr?.message}`);

    const buf = await blob.arrayBuffer();
    if (buf.byteLength > MAX_INLINE_BYTES) {
      throw new Error(`photo_too_large_for_inline:${buf.byteLength}b`);
    }
    const b64 = arrayBufferToBase64(buf);
    const mime = blob.type || 'image/jpeg';

    const geminiResp = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Extract the recipe in this photo into structured JSON. Include rough per-ingredient cost estimates.' },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
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
    let parsed: any;
    try { parsed = JSON.parse(rawText); }
    catch { throw new Error('invalid_json_from_model'); }

    // Update the recipe row.
    const recipePatch: any = {
      instructions: parsed.instructions ?? null,
      total_time_minutes: parsed.total_time_minutes ?? null,
      prep_time_minutes: parsed.prep_time_minutes ?? null,
      cook_time_minutes: parsed.cook_time_minutes ?? null,
      servings: parsed.servings ?? recipe.servings,
      estimated_cost_cents: parsed.total_estimated_cost_cents ?? null,
      extracted_at: new Date().toISOString(),
      extraction_model: MODEL,
    };
    // Update title in three cases:
    //  - caller explicitly asked (overwrite_title=true; new-recipe auto-analyze)
    //  - existing title looks like a filename (the auto-fill case)
    //  - existing title is the new-recipe placeholder
    if (
      parsed.title && (
        body.overwrite_title ||
        /\.(jpg|jpeg|png|webp|heic|gif)$/i.test(recipe.title) ||
        recipe.title === 'Untitled recipe'
      )
    ) {
      recipePatch.title = parsed.title;
    }
    await admin.from('recipes').update(recipePatch).eq('id', recipe.id);

    // Replace ingredient rows wholesale — simpler than diff-update for v1.
    await admin.from('recipe_ingredients').delete().eq('recipe_id', recipe.id);

    const ingredients = (parsed.ingredients ?? []) as any[];
    if (ingredients.length > 0) {
      const rows = ingredients.map((ing, idx) => ({
        recipe_id: recipe.id,
        family_id: recipe.family_id,
        name: (ing.name ?? '').toString().trim() || 'unnamed',
        quantity: typeof ing.quantity === 'number' ? ing.quantity : null,
        unit: ing.unit ?? null,
        free_text_amount: ing.free_text_amount ?? null,
        notes: ing.notes ?? null,
        estimated_cost_cents: typeof ing.estimated_cost_cents === 'number' ? ing.estimated_cost_cents : null,
        sort_order: idx,
      }));
      const ins = await admin.from('recipe_ingredients').insert(rows);
      if (ins.error) throw new Error(`ingredient_insert:${ins.error.message}`);
    }

    return json({
      ingredients_count: ingredients.length,
      instructions_preview: (parsed.instructions ?? '').slice(0, 300),
      total_cost_cents: parsed.total_estimated_cost_cents ?? null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
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
    status, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
