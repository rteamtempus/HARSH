import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE } from './supabase.client';
import { Database } from './database.types';

export type RecipeRow = Database['public']['Tables']['recipes']['Row'];
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert'];
export type RecipeIngredientRow = Database['public']['Tables']['recipe_ingredients']['Row'];
export type RecipeIngredientInsert = Database['public']['Tables']['recipe_ingredients']['Insert'];

/**
 * Family-scoped recipes — see FEATURES_HOUSEHOLD_EXPANSION.md §3.
 *
 * v1 is intentionally tiny: capture a photo + title, browse the grid, view full
 * size. Recipe text extraction via Gemini Vision is a v2 concern.
 */
@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly supabase = inject(SUPABASE);

  readonly recipes = signal<RecipeRow[]>([]);

  private channel: RealtimeChannel | null = null;
  private currentFamilyId: string | null = null;

  async load(familyId: string): Promise<RecipeRow[]> {
    const { data, error } = await this.supabase
      .from('recipes')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    this.recipes.set(data ?? []);
    this.subscribe(familyId);
    return data ?? [];
  }

  /**
   * Upload a photo + create the row in one operation. Returns the new row.
   * The bucket policy uses the first path segment to gate by family — we
   * stick to that convention here.
   */
  async createFromPhoto(input: {
    familyId: string;
    title: string;
    photo: Blob;
    notes?: string;
    tags?: string[];
    memberId?: string | null;
  }): Promise<RecipeRow> {
    // Insert first so we have an id for the storage path.
    const inserted = await this.supabase
      .from('recipes')
      .insert({
        family_id: input.familyId,
        title: input.title.trim(),
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        source: 'photo',
        created_by_member_id: input.memberId ?? null,
      })
      .select('*')
      .single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('insert failed');

    const id = inserted.data.id;
    const ext = blobExtension(input.photo.type);
    const path = `${input.familyId}/${id}.${ext}`;

    const upload = await this.supabase.storage
      .from('recipe-photos')
      .upload(path, input.photo, { contentType: input.photo.type, upsert: false });
    if (upload.error) {
      // Roll back the row if the upload fails so we don't leave orphans.
      await this.supabase.from('recipes').delete().eq('id', id);
      throw upload.error;
    }

    const { data: updated, error: updErr } = await this.supabase
      .from('recipes')
      .update({ photo_path: path })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) throw updErr;
    return updated;
  }

  /** Create a recipe without a photo (manual entry, or paste-from-web later). */
  async create(input: RecipeInsert): Promise<RecipeRow> {
    const { data, error } = await this.supabase
      .from('recipes')
      .insert(input)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, patch: Partial<RecipeRow>): Promise<RecipeRow> {
    const { data, error } = await this.supabase
      .from('recipes').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }

  async remove(id: string): Promise<void> {
    const row = this.recipes().find((r) => r.id === id);
    if (row?.photo_path) {
      await this.supabase.storage.from('recipe-photos').remove([row.photo_path]);
    }
    const { error } = await this.supabase.from('recipes').delete().eq('id', id);
    if (error) throw error;
  }

  /** Load ingredients for one recipe, ordered by sort_order. */
  async loadIngredients(recipeId: string): Promise<RecipeIngredientRow[]> {
    const { data, error } = await this.supabase
      .from('recipe_ingredients').select('*')
      .eq('recipe_id', recipeId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Kick the Gemini-Vision extractor. Returns when extraction completes;
   * realtime will refresh `recipes`/`recipe_ingredients` signals.
   */
  async extractFromPhoto(recipeId: string, options: { overwriteTitle?: boolean } = {}): Promise<{
    ingredients_count: number;
    instructions_preview: string;
    total_cost_cents: number | null;
  }> {
    const { data, error } = await this.supabase.functions.invoke('extract-recipe', {
      body: { recipe_id: recipeId, overwrite_title: options.overwriteTitle ?? false },
    });
    if (error) throw error;
    if (!data || (data as any).error) throw new Error((data as any)?.error ?? 'extraction failed');
    return data as any;
  }

  /**
   * Replace the ingredients for a recipe wholesale with the given list.
   * Used by the edit-mode save path; matches what extract does on re-run.
   */
  async replaceIngredients(
    recipeId: string,
    familyId: string,
    ingredients: Array<Partial<RecipeIngredientInsert> & { name: string }>,
  ): Promise<void> {
    await this.supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
    if (ingredients.length === 0) return;
    const rows = ingredients.map((ing, idx) => ({
      recipe_id: recipeId,
      family_id: familyId,
      name: ing.name.trim() || 'unnamed',
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      free_text_amount: ing.free_text_amount ?? null,
      notes: ing.notes ?? null,
      estimated_cost_cents: ing.estimated_cost_cents ?? null,
      sort_order: idx,
    }));
    const { error } = await this.supabase.from('recipe_ingredients').insert(rows);
    if (error) throw error;
  }

  // ===== Ingredient CRUD (manual edits after extraction) =====

  async addIngredient(input: RecipeIngredientInsert): Promise<RecipeIngredientRow> {
    const { data, error } = await this.supabase
      .from('recipe_ingredients').insert(input).select('*').single();
    if (error) throw error;
    return data;
  }

  async updateIngredient(id: string, patch: Partial<RecipeIngredientRow>): Promise<void> {
    const { error } = await this.supabase.from('recipe_ingredients').update(patch).eq('id', id);
    if (error) throw error;
  }

  async removeIngredient(id: string): Promise<void> {
    const { error } = await this.supabase.from('recipe_ingredients').delete().eq('id', id);
    if (error) throw error;
  }

  /** 1-hour signed URL for the recipe photo, or null if none. */
  async photoUrl(recipe: RecipeRow): Promise<string | null> {
    if (!recipe.photo_path) return null;
    const { data, error } = await this.supabase.storage
      .from('recipe-photos')
      .createSignedUrl(recipe.photo_path, 60 * 60);
    if (error || !data) return null;
    return data.signedUrl;
  }

  private subscribe(familyId: string): void {
    if (this.currentFamilyId === familyId && this.channel) return;
    this.unsubscribe();
    this.currentFamilyId = familyId;
    this.channel = this.supabase
      .channel(`recipes:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recipes', filter: `family_id=eq.${familyId}` },
        () => this.reload(familyId),
      )
      .subscribe();
  }

  private async reload(familyId: string) {
    const { data } = await this.supabase
      .from('recipes').select('*').eq('family_id', familyId)
      .order('created_at', { ascending: false });
    if (data) this.recipes.set(data);
  }

  unsubscribe(): void {
    if (this.channel) { this.supabase.removeChannel(this.channel); this.channel = null; }
    this.currentFamilyId = null;
  }
}

function blobExtension(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}
