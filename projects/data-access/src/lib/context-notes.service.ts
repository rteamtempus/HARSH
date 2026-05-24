import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type ContextNoteRow = Database['public']['Tables']['weekly_context_notes']['Row'];
export type ContextNoteInsert = Database['public']['Tables']['weekly_context_notes']['Insert'];
export type ContextNoteType = ContextNoteRow['type'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DURATION_DAYS = 30;

/**
 * Weekly Context Notes — see FEATURES.md §4.6.1.
 *
 * Ephemeral by design. Max 30-day expiry is enforced server-side via check
 * constraint AND by the reaper RPC that hard-deletes expired rows. This service
 * clamps client-side too as a UX nicety so users get an early error rather
 * than a constraint violation.
 *
 * Tone-layer only — these notes influence briefing voice and may suppress
 * topics, but they never auto-create tasks.
 */
@Injectable({ providedIn: 'root' })
export class ContextNotesService {
  private readonly supabase = inject(SUPABASE);

  readonly notes = signal<ContextNoteRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  /** Active (non-expired) notes for the family. */
  async load(familyId: string): Promise<ContextNoteRow[]> {
    const { data, error } = await this.supabase
      .from('weekly_context_notes')
      .select('*')
      .eq('family_id', familyId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true });
    if (error) throw error;
    this.notes.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  /**
   * Create a context note.
   * @param expiresAt ISO timestamp. Must be in the future, max 30 days out.
   */
  async create(input: {
    familyId: string;
    content: string;
    type: ContextNoteType;
    expiresAt: string;
    influences?: string[];
    suppressTopics?: string[];
    createdByMemberId?: string;
  }): Promise<ContextNoteRow> {
    const expires = new Date(input.expiresAt);
    const now = new Date();
    if (expires <= now) {
      throw new Error('expiresAt must be in the future');
    }
    if (expires.getTime() - now.getTime() > MAX_DURATION_DAYS * MS_PER_DAY) {
      throw new Error(`expiresAt cannot be more than ${MAX_DURATION_DAYS} days from now`);
    }

    const { data, error } = await this.supabase
      .from('weekly_context_notes')
      .insert({
        family_id: input.familyId,
        content: input.content,
        type: input.type,
        expires_at: input.expiresAt,
        influences: input.influences ?? ['briefing_tone'],
        suppress_topics: input.suppressTopics ?? [],
        created_by_member_id: input.createdByMemberId ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('weekly_context_notes').delete().eq('id', id);
    if (error) throw error;
  }

  /** Run the server-side reaper. Idempotent — safe to call from anywhere. */
  async reapExpired(): Promise<number> {
    const { data, error } = await this.supabase.rpc('reap_expired_context_notes');
    if (error) throw error;
    return (data as number) ?? 0;
  }

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`context_notes:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_context_notes', filter: `family_id=eq.${familyId}` },
        () => this.reload(familyId),
      )
      .subscribe();
  }

  private async reload(familyId: string) {
    const { data } = await this.supabase
      .from('weekly_context_notes')
      .select('*')
      .eq('family_id', familyId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true });
    if (data) this.notes.set(data);
  }

  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}
