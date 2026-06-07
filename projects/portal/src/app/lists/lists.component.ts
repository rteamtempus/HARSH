import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AuthService,
  FamilyService,
  InventoryService,
  ListItemRow,
  ListService,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

// Lists CRUD — extracted from the previous home page so the new home can be the
// brain-dump primary surface. See FEATURES.md §2.1 ("Hamburger menu contains:
// list management").

@Component({
  selector: 'harsh-lists',
  standalone: true,
  imports: [FormsModule, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lists.component.html',
  styleUrl: './lists.component.scss',
})
export class ListsComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
  private readonly inventory = inject(InventoryService);
  private readonly router = inject(Router);

  draft = '';
  readonly activeListId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly activeItems = computed<ListItemRow[]>(() => {
    const id = this.activeListId();
    return id ? this.lists.itemsFor(id) : [];
  });
  readonly addPlaceholder = computed(() => {
    const id = this.activeListId();
    const list = this.lists.lists().find((l) => l.id === id);
    return list ? `Add to ${list.name.toLowerCase()}…` : 'Add an item…';
  });

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      const lists = await this.lists.loadLists(fam.id);
      // Load inventory so checking a grocery item can autoroute to in-stock.
      this.inventory.load(fam.id).catch(() => { /* non-fatal */ });
      if (lists[0]) await this.selectList(lists[0].id);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not load lists');
    }
  }

  ngOnDestroy() {
    this.lists.unsubscribe();
  }

  async selectList(id: string) {
    this.activeListId.set(id);
    try { await this.lists.loadItems(id); }
    catch (e: any) { this.error.set(e?.message ?? 'Could not load items'); }
  }

  async add() {
    const listId = this.activeListId();
    const fam = this.family.family();
    if (!listId || !fam) return;
    const text = this.draft;
    this.draft = '';
    this.error.set(null);
    try {
      await this.lists.addItem(listId, text, fam.id, this.family.me()?.id ?? null);
    } catch (e: any) {
      this.draft = text;
      this.error.set(e?.message ?? 'Could not add item');
    }
  }

  async toggle(item: ListItemRow) {
    try { await this.lists.toggleItem(item); }
    catch (e: any) { this.error.set(e?.message ?? 'Could not update'); }
  }

  async remove(item: ListItemRow) {
    try { await this.lists.removeItem(item.id); }
    catch (e: any) { this.error.set(e?.message ?? 'Could not remove'); }
  }
}
