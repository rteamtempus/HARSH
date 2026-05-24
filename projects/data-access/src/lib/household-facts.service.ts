import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type HouseholdFactRow = Database['public']['Tables']['household_facts']['Row'];
export type HouseholdFactInsert = Database['public']['Tables']['household_facts']['Insert'];
export type HouseholdFactUpdate = Database['public']['Tables']['household_facts']['Update'];

/**
 * Persistent household facts — see FEATURES.md §4.7.
 *
 * Not chat history — *facts about your household*. Queried by AI as retrieval
 * context (RAG-style) instead of stuffing everything into every prompt.
 *
 * `key` is unique per family — upserts replace value + bump last_updated.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdFactsService {
  private readonly supabase = inject(SUPABASE);

  readonly facts = signal<HouseholdFactRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<HouseholdFactRow[]> {
    const { data, error } = await this.supabase
      .from('household_facts')
      .select('*')
      .eq('family_id', familyId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('key', { ascending: true });
    if (error) throw error;
    this.facts.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  /** Upsert by (family_id, key). Bumps last_updated server-side via default. */
  async set(familyId: string, key: string, value: string, opts: { category?: string; source?: string } = {}) {
    const { data, error } = await this.supabase
      .from('household_facts')
      .upsert(
        {
          family_id: familyId,
          key,
          value,
          category: opts.category ?? null,
          source: opts.source ?? 'manual',
          last_updated: new Date().toISOString(),
        },
        { onConflict: 'family_id,key' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('household_facts').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Search facts by keyword — used by AI retrieval to assemble per-query context
   * instead of stuffing every fact into the prompt. Simple ILIKE for now; swap
   * to full-text or pgvector when fact count grows past a few dozen.
   */
  async search(familyId: string, query: string, limit = 10): Promise<HouseholdFactRow[]> {
    const term = `%${query.replace(/[%_]/g, '\\$&')}%`;
    const { data, error } = await this.supabase
      .from('household_facts')
      .select('*')
      .eq('family_id', familyId)
      .or(`key.ilike.${term},value.ilike.${term}`)
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`household_facts:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_facts', filter: `family_id=eq.${familyId}` },
        () => this.reload(familyId),
      )
      .subscribe();
  }

  private async reload(familyId: string) {
    const { data } = await this.supabase
      .from('household_facts')
      .select('*')
      .eq('family_id', familyId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('key', { ascending: true });
    if (data) this.facts.set(data);
  }

  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}
