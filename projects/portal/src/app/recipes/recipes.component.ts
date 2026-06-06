import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import {
  FamilyService,
  RecipeIngredientRow,
  RecipeRow,
  RecipeService,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

// Recipes v1 — see FEATURES_HOUSEHOLD_EXPANSION.md §3.
// Photo + title capture, browse grid, view full size. Gemini-Vision text
// extraction is deliberately deferred to v2.

interface Draft { title: string; notes: string; tags: string }

@Component({
  selector: 'harsh-recipes',
  standalone: true,
  imports: [FormsModule, HeaderComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './recipes.component.html',
  styleUrl: './recipes.component.scss',
})
export class RecipesComponent implements OnInit, OnDestroy {
  protected readonly recipes = inject(RecipeService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly adding = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly viewing = signal<RecipeRow | null>(null);
  readonly fullUrl = signal<string | null>(null);
  readonly thumbUrls = signal<Map<string, string>>(new Map());
  readonly ingredients = signal<RecipeIngredientRow[]>([]);
  readonly extracting = signal(false);
  readonly extractError = signal<string | null>(null);

  draft: Draft = { title: '', notes: '', tags: '' };
  private file: File | null = null;

  constructor() {
    // Resolve signed thumbnail URLs whenever the recipe list changes.
    // Reads thumbUrls() via untracked() so writing it doesn't re-trigger this
    // effect — otherwise we'd loop forever.
    effect(() => {
      const list = this.recipes.recipes();
      void this.resolveThumbnails(list);
    });
  }

  private async resolveThumbnails(list: RecipeRow[]): Promise<void> {
    const current = untracked(() => this.thumbUrls());
    const next = new Map(current);
    let changed = false;
    // Drop URLs for deleted recipes.
    for (const id of next.keys()) {
      if (!list.find((r) => r.id === id)) { next.delete(id); changed = true; }
    }
    // Resolve for new ones.
    for (const r of list) {
      if (!next.has(r.id) && r.photo_path) {
        const url = await this.recipes.photoUrl(r);
        if (url) { next.set(r.id, url); changed = true; }
      }
    }
    if (changed) this.thumbUrls.set(next);
  }

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.recipes.load(fam.id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load recipes');
    }
  }

  ngOnDestroy() {
    this.recipes.unsubscribe();
    const p = this.previewUrl();
    if (p) URL.revokeObjectURL(p);
  }

  startAdd() {
    this.draft = { title: '', notes: '', tags: '' };
    this.file = null;
    this.adding.set(true);
    this.error.set(null);
    this.clearPreview();
  }

  cancel() {
    this.adding.set(false);
    this.error.set(null);
    this.clearPreview();
  }

  onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file = file;
    this.clearPreview();
    if (file) {
      this.previewUrl.set(URL.createObjectURL(file));
      // Default title from filename if empty.
      if (!this.draft.title.trim()) {
        this.draft.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      }
    }
  }

  async save() {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.draft.title.trim()) {
      this.error.set('Add a title');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const tags = this.draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (this.file) {
        await this.recipes.createFromPhoto({
          familyId: fam.id,
          title: this.draft.title,
          photo: this.file,
          notes: this.draft.notes.trim() || undefined,
          tags,
          memberId: this.family.me()?.id ?? null,
        });
      } else {
        await this.recipes.create({
          family_id: fam.id,
          title: this.draft.title.trim(),
          notes: this.draft.notes.trim() || null,
          tags,
          source: 'manual',
          created_by_member_id: this.family.me()?.id ?? null,
        });
      }
      this.adding.set(false);
      this.clearPreview();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async open(r: RecipeRow) {
    this.viewing.set(r);
    this.fullUrl.set(null);
    this.ingredients.set([]);
    this.extractError.set(null);
    if (r.photo_path) {
      const url = await this.recipes.photoUrl(r);
      this.fullUrl.set(url);
    }
    try {
      const ings = await this.recipes.loadIngredients(r.id);
      this.ingredients.set(ings);
    } catch (e: any) {
      this.extractError.set(e?.message ?? 'Could not load ingredients');
    }
  }

  async extractRecipe(r: RecipeRow) {
    this.extracting.set(true);
    this.extractError.set(null);
    try {
      await this.recipes.extractFromPhoto(r.id);
      // Reload the row + ingredients so the panel rerenders with the data.
      const fresh = this.recipes.recipes().find((x) => x.id === r.id);
      if (fresh) {
        this.viewing.set(fresh);
        const ings = await this.recipes.loadIngredients(r.id);
        this.ingredients.set(ings);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Extraction failed';
      this.extractError.set(
        msg.includes('GEMINI_API_KEY') || msg.includes('missing_gemini_api_key')
          ? 'Recipe extraction needs the GEMINI_API_KEY secret on the extract-recipe edge function.'
          : msg,
      );
    } finally {
      this.extracting.set(false);
    }
  }

  async editCost(r: RecipeRow) {
    const current = r.estimated_cost_cents != null
      ? (r.estimated_cost_cents / 100).toFixed(2)
      : '';
    const input = prompt('Total estimated cost ($):', current);
    if (input == null) return;
    const dollars = parseFloat(input);
    if (Number.isNaN(dollars)) return;
    try {
      await this.recipes.update(r.id, { estimated_cost_cents: Math.round(dollars * 100) });
    } catch (e: any) {
      this.extractError.set(e?.message ?? 'Save failed');
    }
  }

  formatAmount(ing: RecipeIngredientRow): string {
    if (ing.free_text_amount) return ing.free_text_amount;
    const parts: string[] = [];
    if (ing.quantity != null) parts.push(formatQuantity(ing.quantity));
    if (ing.unit) parts.push(ing.unit);
    return parts.join(' ');
  }

  formatDollars(cents: number | null | undefined): string {
    if (cents == null) return '';
    return `$${(cents / 100).toFixed(2)}`;
  }

  async remove(r: RecipeRow) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    try {
      await this.recipes.remove(r.id);
      this.viewing.set(null);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Delete failed');
    }
  }

  private clearPreview() {
    const p = this.previewUrl();
    if (p) URL.revokeObjectURL(p);
    this.previewUrl.set(null);
  }
}

/** "1.5" → "1½"; "0.25" → "¼". Falls back to a decimal with two places. */
function formatQuantity(q: number): string {
  if (Number.isInteger(q)) return String(q);
  const fractions: Array<[number, string]> = [
    [0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.5, '½'],
    [0.667, '⅔'], [0.75, '¾'],
  ];
  const whole = Math.floor(q);
  const frac = q - whole;
  for (const [v, s] of fractions) {
    if (Math.abs(frac - v) < 0.02) return whole > 0 ? `${whole}${s}` : s;
  }
  return q.toFixed(2).replace(/\.?0+$/, '');
}
