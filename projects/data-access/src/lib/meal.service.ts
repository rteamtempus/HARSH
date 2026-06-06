import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type MealEventRow = Database['public']['Tables']['meal_events']['Row'];

export interface MealCookInput {
  familyId: string;
  recipeId?: string | null;
  recipeName: string;
  servingsMade?: number | null;
  estimatedTotalCostCents?: number | null;
  memberId?: string | null;
  source?: 'manual' | 'voice' | 'brain_dump' | 'weekly_recap';
  occurredAt?: string;
  notes?: string | null;
}

/**
 * Meal events — see FEATURES_HOUSEHOLD_EXPANSION.md §3.
 *
 * Each cook event lands here with a cost snapshot (D1 editable). When
 * something gets thrown away later, the discard handler updates
 * servings_eaten on the most recent meal of that recipe within 7 days,
 * which derives servings_wasted and estimated_value_wasted via stored
 * generated columns.
 */
@Injectable({ providedIn: 'root' })
export class MealService {
  private readonly supabase = inject(SUPABASE);

  readonly recent = signal<MealEventRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string, limit = 60): Promise<void> {
    const { data, error } = await this.supabase
      .from('meal_events').select('*')
      .eq('family_id', familyId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    this.recent.set(data ?? []);
    this.subscribe(familyId);
  }

  /** Log a meal cooked. Captures cost snapshot from the input or recipe. */
  async logCooked(input: MealCookInput): Promise<MealEventRow> {
    const { data, error } = await this.supabase
      .from('meal_events').insert({
        family_id: input.familyId,
        recipe_id: input.recipeId ?? null,
        recipe_name_snapshot: input.recipeName.trim(),
        servings_made: input.servingsMade ?? null,
        estimated_total_cost_cents: input.estimatedTotalCostCents ?? null,
        member_id: input.memberId ?? null,
        source: input.source ?? 'manual',
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        notes: input.notes ?? null,
      })
      .select('*').single();
    if (error) throw error;
    return data;
  }

  /**
   * Record discarded leftovers for the most recent matching meal in the last
   * 7 days. If no matching meal_event exists, create a backfilled one so the
   * waste link is still meaningful (per D9 — discard-time voice path).
   *
   * `servingsEaten` is what was eaten; the difference vs servings_made becomes
   * the waste (derived in the DB).
   */
  async recordDiscard(input: {
    familyId: string;
    recipeName: string;
    servingsEaten?: number | null;
    memberId?: string | null;
    source?: 'voice' | 'manual' | 'brain_dump' | 'weekly_recap';
  }): Promise<MealEventRow> {
    const recent = this.recent();
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const nameLower = input.recipeName.trim().toLowerCase();
    const candidate = recent.find(
      (m) => m.recipe_name_snapshot.toLowerCase() === nameLower
        && new Date(m.occurred_at).getTime() >= cutoff
        && m.servings_eaten === null,
    );
    if (candidate) {
      await this.supabase.from('meal_events').update({
        servings_eaten: input.servingsEaten ?? 0,
      }).eq('id', candidate.id);
      return { ...candidate, servings_eaten: input.servingsEaten ?? 0 } as MealEventRow;
    }
    // Backfill — we didn't see the cook.
    return this.logCooked({
      familyId: input.familyId,
      recipeName: input.recipeName,
      servingsMade: input.servingsEaten != null ? input.servingsEaten + 1 : null,
      memberId: input.memberId ?? null,
      source: input.source ?? 'voice',
    });
  }

  async update(id: string, patch: Partial<MealEventRow>): Promise<void> {
    const { error } = await this.supabase.from('meal_events').update(patch).eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('meal_events').delete().eq('id', id);
    if (error) throw error;
  }

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`meals:${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_events', filter: `family_id=eq.${familyId}` }, () => this.reload(familyId))
      .subscribe();
  }
  private async reload(familyId: string) { await this.load(familyId); }
  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}
