import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  FamilyService,
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
  imports: [FormsModule, HeaderComponent],
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
    if (r.photo_path) {
      const url = await this.recipes.photoUrl(r);
      this.fullUrl.set(url);
    }
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
