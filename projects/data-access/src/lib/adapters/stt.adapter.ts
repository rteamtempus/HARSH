// STT adapter — short-utterance speech-to-text (voice commands, brain-dump dictation).
// Default impl: browser Web Speech API where available; cloud (Gemini/Google STT) fallback.
// For long-form meeting audio, use TranscriptionAdapter instead — it has different latency/cost shape.

import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export interface SttStartOptions {
  locale?: string;            // e.g. 'en-US'
  /** Stop after a stretch of silence (ms). */
  silenceTimeoutMs?: number;
  /** If true, emit interim (partial) results in addition to finals. */
  interim?: boolean;
}

export interface SttTranscriptChunk {
  text: string;
  isFinal: boolean;
  /** 0..1, if the provider returns it. */
  confidence?: number;
}

export interface SttSession {
  /** Stream of partial + final transcripts. Completes when the session ends. */
  transcripts$: Observable<SttTranscriptChunk>;
  stop(): Promise<string>;     // resolves to the final concatenated transcript
  cancel(): void;
}

export interface SttAdapter {
  /** Whether STT is available on this device/browser without server help. */
  isLocalAvailable(): boolean;
  start(options?: SttStartOptions): Promise<SttSession>;
}

export const STT_ADAPTER = new InjectionToken<SttAdapter>('STT_ADAPTER');
