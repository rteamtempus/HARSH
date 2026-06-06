import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import {
  FamilyService,
  HouseholdFactRow,
  HouseholdFactsService,
} from 'data-access';

// Household facts editor — see FEATURES.md §4.7.
// Upsert-by-key: editing changes the value but the key is immutable (delete + add
// to change the key). This matches how AI retrieval keys into them.

interface FactDraft {
  key: string;
  value: string;
  category: string;
}

const EMPTY_DRAFT: FactDraft = { key: '', value: '', category: '' };

const CATEGORIES = ['medical', 'services', 'preferences', 'household', 'kids', 'pets', 'financial', 'misc'];

interface FactGroup { category: string; facts: HouseholdFactRow[] }

@Component({
  selector: 'harsh-household-facts',
  standalone: true,
  imports: [FormsModule, DatePipe, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-facts.component.html',
  styleUrl: './household-facts.component.scss',
})
export class HouseholdFactsComponent implements OnInit, OnDestroy {
  protected readonly facts = inject(HouseholdFactsService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly adding = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  readonly categories = CATEGORIES;
  draft: FactDraft = { ...EMPTY_DRAFT };
  searchQuery = '';
  readonly query = signal('');

  readonly visible = computed(() => {
    const all = this.facts.facts();
    const q = this.query().trim().toLowerCase();
    if (!q) return all;
    return all.filter((f) =>
      f.key.toLowerCase().includes(q) ||
      f.value.toLowerCase().includes(q) ||
      (f.category ?? '').toLowerCase().includes(q),
    );
  });

  readonly grouped = computed<FactGroup[]>(() => {
    const groups = new Map<string, HouseholdFactRow[]>();
    for (const f of this.visible()) {
      const cat = f.category ?? '';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(f);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === b) return 0;
        if (a === '') return 1;
        if (b === '') return -1;
        return a.localeCompare(b);
      })
      .map(([category, facts]) => ({ category, facts }));
  });

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.facts.load(fam.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load facts');
    }
  }

  ngOnDestroy() { this.facts.unsubscribe(); }

  onSearch() { this.query.set(this.searchQuery); }

  startAdd() {
    this.editingId.set(null);
    this.draft = { ...EMPTY_DRAFT };
    this.adding.set(true);
    this.error.set(null);
  }

  startEdit(f: HouseholdFactRow) {
    this.editingId.set(f.id);
    this.draft = { key: f.key, value: f.value, category: f.category ?? '' };
    this.adding.set(true);
    this.error.set(null);
  }

  cancelAdd() {
    this.adding.set(false);
    this.editingId.set(null);
    this.error.set(null);
  }

  async saveNew() {
    const fam = this.family.family();
    if (!fam) return;
    const key = this.draft.key.trim();
    const value = this.draft.value.trim();
    if (!key || !value) {
      this.error.set('Key and value are required');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.facts.set(fam.id, key, value, {
        category: this.draft.category.trim() || undefined,
      });
      this.adding.set(false);
      this.editingId.set(null);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(f: HouseholdFactRow) {
    if (!confirm(`Delete fact "${f.key}"?`)) return;
    try {
      await this.facts.remove(f.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not delete');
    }
  }
}
