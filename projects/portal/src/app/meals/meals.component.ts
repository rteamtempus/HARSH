import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  FamilyService,
  MealEventRow,
  MealService,
  RecipeRow,
  RecipeService,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

interface WeekBucket {
  start: Date;
  label: string;
  meals: MealEventRow[];
  cookedCount: number;
  totalCostCents: number;
  totalWastedCents: number;
}

interface ManualDraft {
  recipeId: string | null;
  recipeName: string;
  servingsMade: number | null;
  costDollars: number | null;
  servingsEaten: number | null;
}

@Component({
  selector: 'harsh-meals',
  standalone: true,
  imports: [FormsModule, DatePipe, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meals.component.html',
  styleUrl: './meals.component.scss',
})
export class MealsComponent implements OnInit, OnDestroy {
  protected readonly meals = inject(MealService);
  protected readonly recipes = inject(RecipeService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly loadError = signal<string | null>(null);
  readonly adding = signal(false);
  readonly busy = signal(false);
  readonly editingId = signal<string | null>(null);

  draft: ManualDraft = emptyDraft();
  editDraft: ManualDraft = emptyDraft();

  readonly thisWeekMeals = computed(() => {
    const cutoff = startOfWeek(new Date()).getTime();
    return this.meals.recent().filter((m) => new Date(m.occurred_at).getTime() >= cutoff);
  });

  readonly thisWeekCost = computed(() =>
    this.thisWeekMeals().reduce((s, m) => s + (m.estimated_total_cost_cents ?? 0), 0),
  );
  readonly thisWeekWasted = computed(() =>
    this.thisWeekMeals().reduce((s, m) => s + (m.estimated_value_wasted_cents ?? 0), 0),
  );

  readonly weeks = computed<WeekBucket[]>(() => {
    const byWeek = new Map<number, WeekBucket>();
    for (const m of this.meals.recent()) {
      const ws = startOfWeek(new Date(m.occurred_at));
      const key = ws.getTime();
      let bucket = byWeek.get(key);
      if (!bucket) {
        bucket = {
          start: ws,
          label: formatWeekLabel(ws),
          meals: [],
          cookedCount: 0,
          totalCostCents: 0,
          totalWastedCents: 0,
        };
        byWeek.set(key, bucket);
      }
      bucket.meals.push(m);
      bucket.cookedCount += 1;
      bucket.totalCostCents += m.estimated_total_cost_cents ?? 0;
      bucket.totalWastedCents += m.estimated_value_wasted_cents ?? 0;
    }
    return [...byWeek.values()].sort((a, b) => b.start.getTime() - a.start.getTime());
  });

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await Promise.all([this.meals.load(fam.id, 200), this.recipes.load(fam.id)]);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load meals');
    }
  }

  ngOnDestroy() {
    this.meals.unsubscribe();
    this.recipes.unsubscribe();
  }

  startAdd(): void {
    this.draft = emptyDraft();
    this.adding.set(true);
  }

  cancelAdd(): void {
    this.adding.set(false);
  }

  pickRecipe(ev: Event): void {
    const id = (ev.target as HTMLSelectElement).value || null;
    this.draft.recipeId = id;
    if (id) {
      const r = this.recipes.recipes().find((x) => x.id === id);
      if (r) {
        this.draft.recipeName = r.title;
        if (this.draft.servingsMade == null) this.draft.servingsMade = r.servings ?? null;
        if (this.draft.costDollars == null && r.estimated_cost_cents != null) {
          this.draft.costDollars = r.estimated_cost_cents / 100;
        }
      }
    }
  }

  async saveAdd(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    const name = this.draft.recipeName.trim();
    if (!name) return;
    this.busy.set(true);
    try {
      const recipe = this.draft.recipeId
        ? this.recipes.recipes().find((r) => r.id === this.draft.recipeId) ?? null
        : null;
      const created = await this.meals.logCooked({
        familyId: fam.id,
        recipeId: recipe?.id ?? null,
        recipeName: recipe?.title ?? name,
        servingsMade: this.draft.servingsMade,
        estimatedTotalCostCents: this.draft.costDollars != null ? Math.round(this.draft.costDollars * 100) : null,
        memberId: this.family.me()?.id ?? null,
        source: 'manual',
      });
      if (this.draft.servingsEaten != null) {
        await this.meals.update(created.id, { servings_eaten: this.draft.servingsEaten });
      }
      this.adding.set(false);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not save meal');
    } finally {
      this.busy.set(false);
    }
  }

  startEdit(m: MealEventRow): void {
    this.editDraft = {
      recipeId: m.recipe_id,
      recipeName: m.recipe_name_snapshot,
      servingsMade: m.servings_made,
      costDollars: m.estimated_total_cost_cents != null ? m.estimated_total_cost_cents / 100 : null,
      servingsEaten: m.servings_eaten,
    };
    this.editingId.set(m.id);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  async saveEdit(m: MealEventRow): Promise<void> {
    this.busy.set(true);
    try {
      await this.meals.update(m.id, {
        recipe_name_snapshot: this.editDraft.recipeName.trim() || m.recipe_name_snapshot,
        servings_made: this.editDraft.servingsMade,
        servings_eaten: this.editDraft.servingsEaten,
        estimated_total_cost_cents: this.editDraft.costDollars != null
          ? Math.round(this.editDraft.costDollars * 100)
          : null,
      });
      this.editingId.set(null);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not update meal');
    } finally {
      this.busy.set(false);
    }
  }

  async logDiscardFor(m: MealEventRow): Promise<void> {
    const eatenRaw = prompt(
      `How many servings of "${m.recipe_name_snapshot}" were eaten before discard? (0 = none)`,
      m.servings_made != null ? String(Math.max(0, m.servings_made - 1)) : '',
    );
    if (eatenRaw === null) return;
    const n = Number(eatenRaw);
    if (Number.isNaN(n) || n < 0) return;
    try {
      await this.meals.update(m.id, { servings_eaten: n });
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Update failed');
    }
  }

  async remove(m: MealEventRow): Promise<void> {
    if (!confirm(`Delete this meal entry?`)) return;
    try { await this.meals.remove(m.id); }
    catch (e: any) { this.loadError.set(e?.message ?? 'Delete failed'); }
  }

  costPerServing(m: MealEventRow): string {
    if (m.estimated_total_cost_cents == null || !m.servings_made) return '';
    return formatDollars(Math.round(m.estimated_total_cost_cents / m.servings_made));
  }

  formatDollars(cents: number | null | undefined): string {
    return formatDollars(cents);
  }

  recipeById(id: string | null): RecipeRow | null {
    if (!id) return null;
    return this.recipes.recipes().find((r) => r.id === id) ?? null;
  }
}

function emptyDraft(): ManualDraft {
  return { recipeId: null, recipeName: '', servingsMade: null, costDollars: null, servingsEaten: null };
}

function formatDollars(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // Sunday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const today = startOfWeek(new Date()).getTime();
  if (start.getTime() === today) return 'This week';
  if (start.getTime() === today - 7 * 24 * 3600 * 1000) return 'Last week';
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}
