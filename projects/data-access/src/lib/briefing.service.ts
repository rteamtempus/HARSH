import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type BriefingRow = Database['public']['Tables']['briefings']['Row'];
export type BriefingType = Database['public']['Enums']['briefing_type'];

/**
 * Structured briefing content. See FEATURES.md §4.5 and
 * supabase/functions/generate-briefing/index.ts (BRIEFING_SCHEMA) for the
 * authoritative shape — Gemini fills these fields per the JSON schema.
 *
 * Stored in `briefings.content` as jsonb; the service normalises shape on read.
 */
export interface BriefingContent {
  hero: string;
  today_shape: string[];
  needs_attention: string[];
  right_now: string[];
  heads_up: string[];
  positive_reinforcement?: string;
}

export interface Briefing {
  id: string;
  family_id: string;
  type: BriefingType;
  content: BriefingContent;
  spoken_text: string | null;
  audio_path: string | null;
  generated_at: string;
  model: string | null;
  latency_ms: number | null;
}

/**
 * Briefings live as a (family, type) cache. Display reads the latest row;
 * regeneration upserts replace it. Caller triggers regen via `generate()`;
 * realtime keeps the signal in sync when scheduled jobs (Phase 2 follow-on)
 * write new rows.
 */
@Injectable({ providedIn: 'root' })
export class BriefingService {
  private readonly supabase = inject(SUPABASE);

  readonly latestDaily = signal<Briefing | null>(null);
  readonly latestWeekly = signal<Briefing | null>(null);
  readonly latestMonthly = signal<Briefing | null>(null);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  /** Load all current briefings for the family. Subscribes to realtime. */
  async load(familyId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('briefings')
      .select('*')
      .eq('family_id', familyId);
    if (error) throw error;
    for (const row of data ?? []) {
      this.assign(row);
    }
    this.subscribe(familyId);
  }

  /**
   * Resolve a signed URL for the cached MP3. Returns null when no audio is
   * available (TTS not configured server-side or synthesis failed).
   * Signed URLs expire after 1 hour by default — re-call to refresh.
   */
  async audioUrl(briefing: Briefing): Promise<string | null> {
    if (!briefing.audio_path) return null;
    const { data, error } = await this.supabase.storage
      .from('briefing-audio')
      .createSignedUrl(briefing.audio_path, 60 * 60);
    if (error || !data) return null;
    return data.signedUrl;
  }

  /** Read whichever briefing of `type` is current. */
  latest(type: BriefingType): Briefing | null {
    if (type === 'daily') return this.latestDaily();
    if (type === 'weekly') return this.latestWeekly();
    return this.latestMonthly();
  }

  /** Kick the generator. Returns the freshly persisted briefing. */
  async generate(familyId: string, type: BriefingType = 'daily'): Promise<Briefing> {
    const { data, error } = await this.supabase.functions.invoke<{
      briefing: BriefingContent;
      spoken_text: string;
      generated_at: string;
      latency_ms: number;
      error?: string;
    }>('generate-briefing', {
      body: { family_id: familyId, type },
    });
    if (error) throw error;
    if (!data || (data as any).error) throw new Error((data as any)?.error ?? 'empty response');

    // The function also wrote to the table; realtime will refresh the signal,
    // but return a synthesized object here for the caller that triggered.
    const synthetic: Briefing = {
      id: 'pending',
      family_id: familyId,
      type,
      content: normalize(data.briefing),
      spoken_text: data.spoken_text,
      audio_path: (data as any).audio_path ?? null,
      generated_at: data.generated_at,
      model: null,
      latency_ms: data.latency_ms ?? null,
    };
    this.assign(rowFromSynthetic(synthetic));
    return synthetic;
  }

  private subscribe(familyId: string): void {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`briefings:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'briefings', filter: `family_id=eq.${familyId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          this.assign(payload.new as BriefingRow);
        },
      )
      .subscribe();
  }

  unsubscribe(): void {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.currentFamilyId = null;
  }

  private assign(row: BriefingRow): void {
    const briefing: Briefing = {
      id: row.id,
      family_id: row.family_id,
      type: row.type,
      content: normalize(row.content),
      spoken_text: row.spoken_text,
      audio_path: row.audio_path,
      generated_at: row.generated_at,
      model: row.model,
      latency_ms: row.latency_ms,
    };
    if (briefing.type === 'daily') this.latestDaily.set(briefing);
    else if (briefing.type === 'weekly') this.latestWeekly.set(briefing);
    else this.latestMonthly.set(briefing);
  }
}

function normalize(raw: unknown): BriefingContent {
  const c = (raw ?? {}) as Partial<BriefingContent>;
  return {
    hero: c.hero ?? '',
    today_shape: c.today_shape ?? [],
    needs_attention: c.needs_attention ?? [],
    right_now: c.right_now ?? [],
    heads_up: c.heads_up ?? [],
    positive_reinforcement: c.positive_reinforcement,
  };
}

function rowFromSynthetic(b: Briefing): BriefingRow {
  return {
    id: b.id,
    family_id: b.family_id,
    type: b.type,
    content: b.content as any,
    spoken_text: b.spoken_text,
    audio_path: b.audio_path,
    generated_at: b.generated_at,
    source_data_hash: null,
    model: b.model,
    latency_ms: b.latency_ms,
    created_at: b.generated_at,
  };
}
