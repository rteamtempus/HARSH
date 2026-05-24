import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  FamilyService,
  ListItemRow,
  ListService,
} from 'data-access';

// Lists CRUD — extracted from the previous home page so the new home can be the
// brain-dump primary surface. See FEATURES.md §2.1 ("Hamburger menu contains:
// list management").

@Component({
  selector: 'harsh-lists',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <header>
        <a routerLink="/" class="back" aria-label="Back to home">←</a>
        <h1>Lists</h1>
      </header>

      @if (lists.lists().length === 0) {
        <p class="muted empty">No lists yet. Add an item from the home page and the AI will create one.</p>
      } @else {
        <nav class="tabs" role="tablist">
          @for (l of lists.lists(); track l.id) {
            <button
              role="tab"
              [class.active]="activeListId() === l.id"
              (click)="selectList(l.id)"
            >{{ l.name }}</button>
          }
        </nav>

        <form class="adder" (submit)="$event.preventDefault(); add()">
          <input
            type="text"
            [(ngModel)]="draft"
            name="draft"
            [placeholder]="addPlaceholder()"
            autocomplete="off"
          />
          <button type="submit" [disabled]="!draft.trim()">Add</button>
        </form>

        <ul class="items">
          @for (item of activeItems(); track item.id) {
            <li [class.checked]="item.checked">
              <button class="check" (click)="toggle(item)" [attr.aria-label]="item.checked ? 'Uncheck' : 'Check'">
                @if (item.checked) { <span>✓</span> }
              </button>
              <span class="text">{{ item.text }}</span>
              <button class="remove" (click)="remove(item)" aria-label="Remove">×</button>
            </li>
          } @empty {
            <li class="muted empty">Nothing here yet. Add the first item above.</li>
          }
        </ul>
      }

      @if (error(); as e) { <p class="error">{{ e }}</p> }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:36rem; margin:0 auto; padding:var(--s-6) var(--s-5) var(--s-8); }
    header { display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-6); }
    h1 { margin:0; font-family:var(--font-display); font-size:var(--fs-h1); }
    .back { background:transparent; border:1px solid var(--line-default); border-radius:var(--r-md); padding:var(--s-1) var(--s-3); color:var(--text-primary); text-decoration:none; font-size:var(--fs-body); }

    .tabs { display:flex; gap:var(--s-2); margin-bottom:var(--s-4); flex-wrap:wrap; }
    .tabs button { background:var(--bg-surface); border:1px solid var(--line-subtle); color:var(--text-secondary); padding:var(--s-2) var(--s-4); border-radius:var(--r-pill); cursor:pointer; font-size:var(--fs-small); font-weight:500; }
    .tabs button.active { background:var(--accent); color:var(--text-on-accent); border-color:var(--accent); }

    .adder { display:flex; gap:var(--s-2); margin-bottom:var(--s-4); }
    .adder input { flex:1; padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    .adder input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .adder button { padding:var(--s-3) var(--s-5); font-size:var(--fs-body); border-radius:var(--r-md); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; cursor:pointer; }
    .adder button:disabled { opacity:0.5; cursor:default; }

    .items { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .items li { display:flex; align-items:center; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-3) var(--s-4); border-radius:var(--r-md); border:1px solid var(--line-subtle); box-shadow:var(--shadow-sm); }
    .items li.checked { opacity:0.55; }
    .items li.checked .text { text-decoration:line-through; }
    .check { width:1.6rem; height:1.6rem; flex:none; border-radius:var(--r-sm); border:1.5px solid var(--line-strong); background:var(--bg-sunken); cursor:pointer; display:grid; place-items:center; color:var(--text-on-accent); font-weight:700; padding:0; }
    .items li.checked .check { background:var(--success); border-color:var(--success); }
    .text { flex:1; font-size:var(--fs-body); }
    .remove { background:transparent; border:0; color:var(--text-tertiary); font-size:var(--fs-h2); cursor:pointer; padding:0 var(--s-2); line-height:1; }
    .remove:hover { color:var(--danger); }

    .muted.empty { color:var(--text-tertiary); padding:var(--s-5) 0; text-align:center; font-style:italic; }
    .error { color:var(--danger); margin-top:var(--s-4); font-size:var(--fs-small); }
  `],
})
export class ListsComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
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
