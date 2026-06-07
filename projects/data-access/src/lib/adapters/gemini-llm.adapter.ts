import { Injectable, inject } from '@angular/core';
import { SUPABASE } from '../supabase.client';
import {
  LlmAdapter,
  LlmCallOptions,
  LlmStructuredResult,
} from './llm.adapter';

// Concrete LLM adapter — wraps the `llm` Supabase Edge Function (Gemini 2.5 Flash).
// See supabase/functions/llm/index.ts for the server-side bridge.
//
// Use via DI: provide `{ provide: LLM_ADAPTER, useClass: GeminiLlmAdapter }` in
// your app config. Feature code consumes the LlmAdapter interface, not this class,
// so swapping vendors is a one-line change.

interface EdgeResponse<T> {
  data: T;
  rawText: string;
  modelId: string;
  latencyMs: number;
}

@Injectable({ providedIn: 'root' })
export class GeminiLlmAdapter implements LlmAdapter {
  private readonly supabase = inject(SUPABASE);

  async generateStructured<T>(
    prompt: string,
    options: LlmCallOptions,
  ): Promise<LlmStructuredResult<T>> {
    if (!options.schema) {
      throw new Error('generateStructured requires options.schema');
    }
    const { data, error } = await this.supabase.functions.invoke<EdgeResponse<T>>('llm', {
      body: {
        prompt,
        system: options.system,
        tier: options.tier ?? 'fast',
        schema: options.schema,
        maxOutputTokens: options.maxOutputTokens,
        intentLabel: options.intentLabel,
        images: mapImages(options.images),
      },
    });
    if (error) throw error;
    if (!data) throw new Error('empty llm response');
    return data;
  }

  async generateText(
    prompt: string,
    options: LlmCallOptions = {},
  ): Promise<LlmStructuredResult<string>> {
    const { data, error } = await this.supabase.functions.invoke<EdgeResponse<string>>('llm', {
      body: {
        prompt,
        system: options.system,
        tier: options.tier ?? 'fast',
        maxOutputTokens: options.maxOutputTokens,
        intentLabel: options.intentLabel,
        images: mapImages(options.images),
      },
    });
    if (error) throw error;
    if (!data) throw new Error('empty llm response');
    return data;
  }
}

function mapImages(images: LlmCallOptions['images']) {
  if (!images?.length) return undefined;
  return images.map((i) => ({ mime_type: i.mimeType, data: i.base64Data }));
}
