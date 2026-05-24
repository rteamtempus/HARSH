import { Injectable, inject } from '@angular/core';
import { SUPABASE } from '../supabase.client';
import {
  TtsAdapter,
  TtsSynthesisResult,
  TtsSynthesizeOptions,
} from './tts.adapter';

// Concrete TTS adapter — calls the `tts` Supabase Edge Function which proxies
// Google Cloud Text-to-Speech (Chirp 3 HD). See supabase/functions/tts/index.ts.
//
// Provide via DI: `{ provide: TTS_ADAPTER, useClass: GoogleTtsAdapter }` in
// the portal app config. Feature code consumes the TtsAdapter interface only.
//
// Audio caching (FEATURES.md §5.4): cacheKey is currently ignored — server-side
// cache lives next to briefings. When the briefing pipeline lands, it can pass
// a stable key to dedupe synthesis across replays.

interface TtsEdgeResponse { audio: string; mimeType: string; error?: string }

// Curated Chirp 3 HD voice list. Google ships ~30 of these; this list is the
// English subset best suited to the "calm warm partner" voice in FEATURES.md.
// The default is the first entry.
//
// Update when Google ships new voices: gcloud text-to-speech voices list \
//   --filter='name:Chirp3-HD'
const CHIRP3_VOICES: Array<{ id: string; label: string; locale: string; description: string }> = [
  { id: 'en-US-Chirp3-HD-Aoede',    label: 'Aoede',    locale: 'en-US', description: 'female, warm, conversational (default)' },
  { id: 'en-US-Chirp3-HD-Achernar', label: 'Achernar', locale: 'en-US', description: 'female, bright' },
  { id: 'en-US-Chirp3-HD-Charon',   label: 'Charon',   locale: 'en-US', description: 'male, grounded' },
  { id: 'en-US-Chirp3-HD-Fenrir',   label: 'Fenrir',   locale: 'en-US', description: 'male, dry' },
  { id: 'en-US-Chirp3-HD-Kore',     label: 'Kore',     locale: 'en-US', description: 'female, measured' },
  { id: 'en-US-Chirp3-HD-Leda',     label: 'Leda',     locale: 'en-US', description: 'female, soft' },
  { id: 'en-US-Chirp3-HD-Orus',     label: 'Orus',     locale: 'en-US', description: 'male, warm' },
  { id: 'en-US-Chirp3-HD-Puck',     label: 'Puck',     locale: 'en-US', description: 'male, lively' },
  { id: 'en-US-Chirp3-HD-Schedar',  label: 'Schedar',  locale: 'en-US', description: 'male, calm' },
  { id: 'en-US-Chirp3-HD-Umbriel',  label: 'Umbriel',  locale: 'en-US', description: 'male, casual' },
  { id: 'en-US-Chirp3-HD-Zephyr',   label: 'Zephyr',   locale: 'en-US', description: 'female, bright' },
];

export const GOOGLE_DEFAULT_VOICE = CHIRP3_VOICES[0].id;

@Injectable({ providedIn: 'root' })
export class GoogleTtsAdapter implements TtsAdapter {
  private readonly supabase = inject(SUPABASE);

  async synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsSynthesisResult> {
    const { data, error } = await this.supabase.functions.invoke<TtsEdgeResponse>('tts', {
      body: {
        text,
        voiceId: options.voiceId,
        ssml: options.ssml,
        speakingRate: options.speakingRate,
      },
    });
    if (error) throw error;
    if (!data || data.error || !data.audio) {
      throw new Error(data?.error ?? 'tts empty response');
    }
    const audio = base64ToArrayBuffer(data.audio);
    return {
      audio,
      mimeType: data.mimeType ?? 'audio/mp3',
      provider: 'google-chirp3-hd',
      cached: false,
    };
  }

  async listVoices() {
    // Static for now — Google's voices.list API works but the catalog rarely changes.
    // If we ever want dynamic discovery, swap this for a call into the edge function.
    return CHIRP3_VOICES;
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}
