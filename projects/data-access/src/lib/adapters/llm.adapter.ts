// LLM adapter — vendor-neutral interface for chat / structured-output calls.
// Default impl today: Gemini 2.5 Flash via Supabase Edge Function (server-side key).
// Add a new provider by implementing this interface; do NOT call vendor SDKs directly from feature code.
// See FEATURES.md §5.1 (model tiering) and §8 (adapter discipline).

import { InjectionToken } from '@angular/core';

export type LlmTier = 'fast' | 'synthesis';

export interface LlmCallOptions {
  /** Selects the underlying model tier; the adapter maps to a concrete model. */
  tier?: LlmTier;
  /** Optional JSON schema for structured output. */
  schema?: unknown;
  /** Optional system prompt. */
  system?: string;
  /** Cap on response tokens; adapters may clamp. */
  maxOutputTokens?: number;
  /** Free-text label for ai_log debugging. */
  intentLabel?: string;
}

export interface LlmStructuredResult<T> {
  data: T;
  rawText: string;
  modelId: string;
  latencyMs: number;
}

export interface LlmAdapter {
  /** Returns a structured JSON object matching `options.schema`. */
  generateStructured<T>(prompt: string, options: LlmCallOptions): Promise<LlmStructuredResult<T>>;
  /** Returns plain-text generation. */
  generateText(prompt: string, options?: LlmCallOptions): Promise<LlmStructuredResult<string>>;
}

export const LLM_ADAPTER = new InjectionToken<LlmAdapter>('LLM_ADAPTER');
