import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type WasteEventRow = Database['public']['Tables']['waste_events']['Row'];
export type WasteReason = Database['public']['Enums']['waste_reason'];

export interface WasteLogInput {
  familyId: string;
  itemId?: string | null;
  freeTextName?: string | null;
  reason: WasteReason;
  percentage?: number;                   // 0–100; defaults to 100
  estimatedValueCents?: number | null;
  source?: 'manual' | 'voice' | 'brain_dump' | 'waste_dump';
  mealEventId?: string | null;
  memberId?: string | null;
  occurredAt?: string;
  note?: string | null;
  quantityText?: string | null;
}

/**
 * Waste tracking — see FEATURES_HOUSEHOLD_EXPANSION.md §5.
 *
 * Three capture surfaces feed this:
 *   - regular brain dump (passive recognition of waste phrases)
 *   - dedicated /waste page with quick form + waste brain-dump textarea
 *   - voice ("we threw out X")
 * All paths route through log().
 */
@Injectable({ providedIn: 'root' })
export class WasteService {
  private readonly supabase = inject(SUPABASE);

  readonly recent = signal<WasteEventRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string, limit = 100): Promise<void> {
    const { data, error } = await this.supabase
      .from('waste_events').select('*')
      .eq('family_id', familyId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    this.recent.set(data ?? []);
    this.subscribe(familyId);
  }

  async log(input: WasteLogInput): Promise<WasteEventRow> {
    const pct = Math.min(100, Math.max(0, input.percentage ?? 100));
    const { data, error } = await this.supabase
      .from('waste_events')
      .insert({
        family_id: input.familyId,
        item_id: input.itemId ?? null,
        meal_event_id: input.mealEventId ?? null,
        free_text_name: input.freeTextName ?? null,
        reason: input.reason,
        percentage_wasted: pct,
        estimated_value_cents: input.estimatedValueCents ?? null,
        source: input.source ?? 'manual',
        member_id: input.memberId ?? null,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        quantity_text: input.quantityText ?? null,
        note: input.note ?? null,
      })
      .select('*').single();
    if (error) throw error;
    return data;
  }

  async update(id: string, patch: Partial<WasteEventRow>): Promise<void> {
    const { error } = await this.supabase.from('waste_events').update(patch).eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('waste_events').delete().eq('id', id);
    if (error) throw error;
  }

  /** Sum of estimated_value_cents within the last `daysBack` days. Null values count as 0. */
  weeklyTotal(daysBack = 7): number {
    const cutoff = Date.now() - daysBack * 24 * 3600 * 1000;
    return this.recent()
      .filter((r) => new Date(r.occurred_at).getTime() >= cutoff)
      .reduce((sum, r) => sum + (r.estimated_value_cents ?? 0), 0);
  }

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`waste:${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waste_events', filter: `family_id=eq.${familyId}` }, () => this.reload(familyId))
      .subscribe();
  }

  private async reload(familyId: string) { await this.load(familyId); }

  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}
