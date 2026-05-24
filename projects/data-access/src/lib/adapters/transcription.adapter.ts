// Transcription adapter — long-form audio (weekly planning meetings, §4.6).
// Cloud now (Gemini audio / Google STT); local Whisper later. Adapter exists so the
// extraction/review pipeline doesn't have to change when the transcription source does.

import { InjectionToken } from '@angular/core';

export interface TranscriptionJobInput {
  /** Audio file blob (uploaded to storage by caller). */
  storagePath: string;        // e.g. 'meeting-audio/<family_id>/<meeting_id>.webm'
  /** Used to derive ai_log + meeting_notes ownership. */
  familyId: string;
  /** If true, request speaker diarization (per-segment speaker id). */
  diarize?: boolean;
  /** Hint about expected language. */
  locale?: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;      // e.g. 'speaker_0', 'speaker_1' — assignment happens during review
}

export interface TranscriptionJobResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  segments?: TranscriptSegment[];
  fullText?: string;
  error?: string;
  /** Provider identifier (e.g. 'gemini-audio', 'google-stt', 'whisper-local'). */
  provider: string;
}

export interface TranscriptionAdapter {
  /** Kick off a background transcription. Returns a jobId immediately. */
  submit(input: TranscriptionJobInput): Promise<{ jobId: string }>;
  /** Polled by client or pushed by realtime; returns terminal state when done. */
  fetch(jobId: string): Promise<TranscriptionJobResult>;
}

export const TRANSCRIPTION_ADAPTER = new InjectionToken<TranscriptionAdapter>('TRANSCRIPTION_ADAPTER');
