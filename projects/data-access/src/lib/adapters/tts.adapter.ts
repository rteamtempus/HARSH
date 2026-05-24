// TTS adapter — see FEATURES.md §5.4.
// Default impl: Google Chirp 3 HD via a Supabase Edge Function proxy (key stays server-side).
// Swap targets: ElevenLabs (cloud), Piper (Pi-local), Coqui XTTS (gaming-PC-local).

import { InjectionToken } from '@angular/core';

export interface TtsSynthesizeOptions {
  /** Voice id native to the provider (e.g. Google "en-US-Chirp3-HD-..."). */
  voiceId: string;
  /** If true, treat `text` as SSML rather than plain. Use sparingly (§5.4). */
  ssml?: boolean;
  /** Optional speaking-rate adjustment 0.5..2.0 (provider may clamp). */
  speakingRate?: number;
  /** Cache key — if the adapter supports caching, supply a stable key (e.g. briefing id). */
  cacheKey?: string;
}

export interface TtsSynthesisResult {
  /** Raw audio bytes. MIME type is provider-determined; see `mimeType`. */
  audio: ArrayBuffer;
  mimeType: string;
  /** Provider identifier (e.g. 'google-chirp3-hd'). */
  provider: string;
  cached: boolean;
}

export interface TtsAdapter {
  synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsSynthesisResult>;
  /** Available voices for the family voice-picker UI. */
  listVoices(): Promise<Array<{ id: string; label: string; locale: string; description?: string }>>;
}

export const TTS_ADAPTER = new InjectionToken<TtsAdapter>('TTS_ADAPTER');
