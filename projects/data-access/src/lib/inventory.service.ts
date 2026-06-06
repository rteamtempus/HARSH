import { Injectable, computed, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type InventoryCategoryRow = Database['public']['Tables']['inventory_categories']['Row'];
export type InventoryItemRow = Database['public']['Tables']['inventory_items']['Row'];
export type InventoryEventRow = Database['public']['Tables']['inventory_events']['Row'];
export type InventoryItemInsert = Database['public']['Tables']['inventory_items']['Insert'];
export type InventoryItemUpdate = Database['public']['Tables']['inventory_items']['Update'];

/**
 * Inventory: categories + items + the resolution helpers the voice intents
 * lean on. See FEATURES_HOUSEHOLD_EXPANSION.md §4 + D2 (resolution ladder).
 *
 * - load(familyId) once; realtime keeps signals in sync.
 * - resolveForVoice() implements the D2 ladder used by ai-intent for the
 *   "we're out of X" / "we have X" / "do we have X?" phrases.
 */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly supabase = inject(SUPABASE);

  readonly categories = signal<InventoryCategoryRow[]>([]);
  readonly items = signal<InventoryItemRow[]>([]);

  readonly activeItems = computed(() => this.items().filter((i) => !i.archived));

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<void> {
    const [cats, items] = await Promise.all([
      this.supabase.from('inventory_categories').select('*')
        .eq('family_id', familyId).eq('archived', false)
        .order('sort_order', { ascending: true }),
      this.supabase.from('inventory_items').select('*')
        .eq('family_id', familyId).eq('archived', false)
        .order('name', { ascending: true }),
    ]);
    if (cats.error) throw cats.error;
    if (items.error) throw items.error;
    this.categories.set(cats.data ?? []);
    this.items.set(items.data ?? []);
    this.subscribe(familyId);
  }

  // ===== Categories =====

  async createCategory(familyId: string, name: string, color?: string): Promise<InventoryCategoryRow> {
    const sortOrder = Math.max(0, ...this.categories().map((c) => c.sort_order)) + 10;
    const { data, error } = await this.supabase
      .from('inventory_categories')
      .insert({ family_id: familyId, name: name.trim(), color: color ?? '#717744', sort_order: sortOrder })
      .select('*').single();
    if (error) throw error;
    return data;
  }

  async updateCategory(id: string, patch: Partial<InventoryCategoryRow>): Promise<void> {
    const { error } = await this.supabase.from('inventory_categories').update(patch).eq('id', id);
    if (error) throw error;
  }

  async archiveCategory(id: string): Promise<void> {
    const { error } = await this.supabase.from('inventory_categories')
      .update({ archived: true }).eq('id', id);
    if (error) throw error;
  }

  /** Misc category for a family (creates it if missing — used as a fallback for uncategorized items). */
  async ensureMiscCategory(familyId: string): Promise<InventoryCategoryRow> {
    const existing = this.categories().find((c) => c.name.toLowerCase() === 'misc');
    if (existing) return existing;
    return this.createCategory(familyId, 'Misc', '#717744');
  }

  // ===== Items =====

  async createItem(input: InventoryItemInsert): Promise<InventoryItemRow> {
    const { data, error } = await this.supabase
      .from('inventory_items').insert(input).select('*').single();
    if (error) throw error;
    return data;
  }

  async updateItem(id: string, patch: InventoryItemUpdate): Promise<void> {
    const { error } = await this.supabase.from('inventory_items').update(patch).eq('id', id);
    if (error) throw error;
  }

  /**
   * Mark in/out of stock + write an audit event. If `addToGroceryListId`
   * is provided and the item just went out, the caller adds it to that list.
   */
  async setInStock(item: InventoryItemRow, inStock: boolean, opts: {
    source?: Database['public']['Enums']['inventory_event_source'];
    memberId?: string | null;
    note?: string;
  } = {}): Promise<void> {
    await this.updateItem(item.id, { in_stock: inStock });
    await this.supabase.from('inventory_events').insert({
      family_id: item.family_id,
      item_id: item.id,
      kind: inStock ? 'added' : 'removed',
      source: opts.source ?? 'manual',
      member_id: opts.memberId ?? null,
      note: opts.note ?? null,
    });
  }

  async setCount(item: InventoryItemRow, count: number, opts: {
    source?: Database['public']['Enums']['inventory_event_source'];
    memberId?: string | null;
  } = {}): Promise<void> {
    const previous = item.quantity_count ?? 0;
    await this.updateItem(item.id, {
      quantity_count: count,
      in_stock: count > 0,
    });
    await this.supabase.from('inventory_events').insert({
      family_id: item.family_id,
      item_id: item.id,
      kind: 'manual_edit',
      source: opts.source ?? 'manual',
      quantity_delta: count - previous,
      member_id: opts.memberId ?? null,
    });
  }

  async archiveItem(id: string): Promise<void> {
    const { error } = await this.supabase.from('inventory_items')
      .update({ archived: true }).eq('id', id);
    if (error) throw error;
  }

  // ===== Voice resolution (D2 ladder) =====

  /**
   * Resolve a user phrase like "low sodium soy sauce" or "soy sauce" into
   * either a specific item or a category-plus-suggested-name.
   *
   * Returns one of:
   *   { kind: 'item', item }              — matched a specific item
   *   { kind: 'category', category, name } — matched a category; `name` is the
   *                                          item name to use when adding to grocery
   *                                          (matches the category, or includes
   *                                          indicator words)
   *   { kind: 'none', name }              — no match; suggest Misc category
   */
  resolveForVoice(phrase: string): VoiceResolution {
    const p = phrase.trim().toLowerCase();
    if (!p) return { kind: 'none', name: phrase };

    // 1) Exact-ish item match against normalized_name.
    const items = this.activeItems();
    const exactItem = items.find((i) => (i.normalized_name ?? '').includes(p));
    if (exactItem) return { kind: 'item', item: exactItem };

    // 2) Category match — find a category whose name is a substring of the phrase.
    const cats = this.categories();
    const category = cats.find((c) => p.includes(c.name.toLowerCase()));
    if (!category) return { kind: 'none', name: phrase };

    // Items in this category.
    const inCat = items.filter((i) => i.category_id === category.id);

    if (inCat.length === 0) {
      // D2.1: empty category → add a generic item named after the category.
      return { kind: 'category', category, name: category.name };
    }
    if (inCat.length === 1) {
      // D2.2: single item → use that item.
      return { kind: 'item', item: inCat[0] };
    }
    // D2.3: multiple — try to match indicator words against item names.
    const categoryWords = new Set(category.name.toLowerCase().split(/\s+/));
    const indicatorTokens = p.split(/\s+/).filter((t) => !categoryWords.has(t));
    if (indicatorTokens.length > 0) {
      const indicatorPhrase = indicatorTokens.join(' ');
      const indicated = inCat.find((i) =>
        (i.normalized_name ?? '').includes(indicatorPhrase),
      );
      if (indicated) return { kind: 'item', item: indicated };
    }
    // D2.4: no indicator → use the marked default if set; else fall back to
    // first item.
    const def = inCat.find((i) => i.is_category_default) ?? inCat[0];
    return { kind: 'item', item: def };
  }

  // ===== Realtime =====

  private subscribe(familyId: string) {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`inventory:${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_categories', filter: `family_id=eq.${familyId}` }, () => this.reload(familyId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `family_id=eq.${familyId}` }, () => this.reload(familyId))
      .subscribe();
  }

  private async reload(familyId: string) {
    await this.load(familyId);
  }

  unsubscribe() {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}

export type VoiceResolution =
  | { kind: 'item'; item: InventoryItemRow }
  | { kind: 'category'; category: InventoryCategoryRow; name: string }
  | { kind: 'none'; name: string };
