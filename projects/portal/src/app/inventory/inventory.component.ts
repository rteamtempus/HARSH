import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  FamilyService,
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryService,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

interface CategoryGroup { category: InventoryCategoryRow | null; items: InventoryItemRow[] }
interface ItemDraft {
  id: string | null;
  name: string;
  category_id: string | null;
  brand: string;
  size_text: string;
  variant_notes: string;
  tracks_count: boolean;
  quantity_count: number | null;
  is_category_default: boolean;
}
interface CategoryDraft { name: string }

const EMPTY_ITEM: ItemDraft = {
  id: null, name: '', category_id: null, brand: '', size_text: '', variant_notes: '',
  tracks_count: false, quantity_count: 0, is_category_default: false,
};

@Component({
  selector: 'harsh-inventory',
  standalone: true,
  imports: [FormsModule, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss',
})
export class InventoryComponent implements OnInit, OnDestroy {
  protected readonly inventory = inject(InventoryService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly catEditing = signal(false);
  readonly itemEditing = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  catDraft: CategoryDraft = { name: '' };
  itemDraft: ItemDraft = { ...EMPTY_ITEM };

  readonly groupedByCategory = computed<CategoryGroup[]>(() => {
    const cats = this.inventory.categories();
    const items = this.inventory.activeItems();
    const groups: CategoryGroup[] = cats.map((c) => ({
      category: c,
      items: items.filter((i) => i.category_id === c.id),
    }));
    const uncategorized = items.filter((i) => !i.category_id);
    if (uncategorized.length) groups.push({ category: null, items: uncategorized });
    return groups.filter((g) => g.items.length > 0);
  });

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.inventory.load(fam.id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load inventory');
    }
  }

  ngOnDestroy() { this.inventory.unsubscribe(); }

  variantLine(item: InventoryItemRow): string | null {
    const bits = [item.brand, item.size_text, item.variant_notes].filter(Boolean) as string[];
    return bits.length ? bits.join(' · ') : null;
  }

  // ----- Item edit -----

  startAddItem(): void {
    this.itemDraft = { ...EMPTY_ITEM };
    this.itemEditing.set(true);
    this.error.set(null);
  }

  startEditItem(item: InventoryItemRow): void {
    this.itemDraft = {
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      brand: item.brand ?? '',
      size_text: item.size_text ?? '',
      variant_notes: item.variant_notes ?? '',
      tracks_count: item.tracks_count,
      quantity_count: item.quantity_count ?? 0,
      is_category_default: item.is_category_default,
    };
    this.itemEditing.set(true);
    this.error.set(null);
  }

  async saveItem(): Promise<void> {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.itemDraft.name.trim()) { this.error.set('Name is required'); return; }
    this.busy.set(true);
    try {
      if (this.itemDraft.id) {
        await this.inventory.updateItem(this.itemDraft.id, {
          name: this.itemDraft.name.trim(),
          category_id: this.itemDraft.category_id,
          brand: this.itemDraft.brand.trim() || null,
          size_text: this.itemDraft.size_text.trim() || null,
          variant_notes: this.itemDraft.variant_notes.trim() || null,
          tracks_count: this.itemDraft.tracks_count,
          quantity_count: this.itemDraft.tracks_count ? (this.itemDraft.quantity_count ?? 0) : null,
          is_category_default: this.itemDraft.is_category_default,
        });
      } else {
        await this.inventory.createItem({
          family_id: fam.id,
          name: this.itemDraft.name.trim(),
          category_id: this.itemDraft.category_id,
          brand: this.itemDraft.brand.trim() || null,
          size_text: this.itemDraft.size_text.trim() || null,
          variant_notes: this.itemDraft.variant_notes.trim() || null,
          tracks_count: this.itemDraft.tracks_count,
          quantity_count: this.itemDraft.tracks_count ? (this.itemDraft.quantity_count ?? 0) : null,
          is_category_default: this.itemDraft.is_category_default,
        });
      }
      this.itemEditing.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async archiveItem(): Promise<void> {
    if (!this.itemDraft.id) return;
    if (!confirm('Archive this item?')) return;
    try {
      await this.inventory.archiveItem(this.itemDraft.id);
      this.itemEditing.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Archive failed');
    }
  }

  // ----- Category edit -----

  startAddCategory(): void {
    this.catDraft = { name: '' };
    this.catEditing.set(true);
  }

  async saveCategory(): Promise<void> {
    const fam = this.family.family();
    if (!fam || !this.catDraft.name.trim()) return;
    this.busy.set(true);
    try {
      await this.inventory.createCategory(fam.id, this.catDraft.name);
      this.catEditing.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Quick toggles -----

  async toggleInStock(item: InventoryItemRow): Promise<void> {
    try {
      await this.inventory.setInStock(item, !item.in_stock, {
        source: 'manual',
        memberId: this.family.me()?.id ?? null,
      });
    } catch (e: any) {
      this.error.set(e?.message ?? 'Update failed');
    }
  }

  async adjustCount(item: InventoryItemRow, delta: number): Promise<void> {
    const next = Math.max(0, (item.quantity_count ?? 0) + delta);
    try {
      await this.inventory.setCount(item, next, {
        source: 'manual',
        memberId: this.family.me()?.id ?? null,
      });
    } catch (e: any) {
      this.error.set(e?.message ?? 'Update failed');
    }
  }
}
