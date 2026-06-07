import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AiService,
  BrainDumpContext,
  BrainDumpService,
  BriefingService,
  CalendarAccountRow,
  CalendarService,
  ContextNotesService,
  EventRow,
  EventService,
  FamilyService,
  HouseholdFactsService,
  InventoryService,
  ListItemRow,
  ListRow,
  ListService,
  MealService,
  ProfileService,
  RecipeService,
  RoutineOccurrence,
  RoutineService,
  ThemeService,
  VoiceService,
  WasteService,
  occurrencesForRoutines,
} from 'data-access';
import { DayViewComponent } from './views/day-view.component';
import { WeekViewComponent } from './views/week-view.component';
import { MonthViewComponent } from './views/month-view.component';
import { BriefingViewComponent } from './views/briefing-view.component';
import {
  addDays,
  endOfDay,
  endOfMonthGrid,
  endOfWeek,
  parseYmd,
  startOfDay,
  startOfMonthGrid,
  startOfWeek,
} from './date-utils';

export type CalView = 'briefing' | 'day' | 'week' | 'month';

@Component({
  selector: 'harsh-board',
  standalone: true,
  imports: [DayViewComponent, WeekViewComponent, MonthViewComponent, BriefingViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
})
export class BoardComponent implements OnInit, OnDestroy {
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
  protected readonly events = inject(EventService);
  protected readonly calendars = inject(CalendarService);
  protected readonly voice = inject(VoiceService);
  protected readonly theme = inject(ThemeService);
  protected readonly briefings = inject(BriefingService);
  protected readonly routines = inject(RoutineService);
  private readonly ai = inject(AiService);
  private readonly inventory = inject(InventoryService);
  private readonly waste = inject(WasteService);
  private readonly meals = inject(MealService);
  private readonly recipeService = inject(RecipeService);
  private readonly facts = inject(HouseholdFactsService);
  private readonly contextNotes = inject(ContextNotesService);
  private readonly profiles = inject(ProfileService);
  private readonly brainDump = inject(BrainDumpService);
  private readonly router = inject(Router);

  readonly now = signal('');
  readonly nowDate = signal(new Date());
  // Default view = briefing (FEATURES.md §4.5: "briefing = primary view")
  readonly view = signal<CalView>('briefing');
  readonly anchor = signal<Date>(new Date());
  readonly activeListId = signal<string | null>(null);
  readonly heard = signal<string | null>(null);
  readonly reply = signal<string | null>(null);
  readonly wakeFlash = signal(false);
  readonly menuOpen = signal(false);
  readonly fullscreen = signal(!!document.fullscreenElement);
  readonly familyDisplayName = computed(() => acronymize(this.family.family()?.name ?? 'HARSH'));

  // Bound to view inputs so they pick up account colors.
  protected colorForFn = (e: EventRow) => this.colorFor(e);

  private accountById = signal<Map<string, CalendarAccountRow>>(new Map());
  private clockHandle: ReturnType<typeof setInterval> | null = null;
  private stopWake: (() => void) | null = null;
  private replyTimer: ReturnType<typeof setTimeout> | null = null;
  private heardTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly activeList = computed<ListRow | null>(() => {
    const id = this.activeListId();
    return (
      this.lists.lists().find((l) => l.id === id) ??
      this.lists.lists().find((l) => l.kind === 'todo') ??
      this.lists.lists()[0] ??
      null
    );
  });
  readonly allItems = computed<ListItemRow[]>(() => {
    const id = this.activeList()?.id;
    return id ? this.lists.itemsFor(id) : [];
  });
  readonly openItems = computed(() => this.allItems().filter((i) => !i.checked));
  readonly checkedItems = computed(() => this.allItems().filter((i) => i.checked));

  // Routine occurrences across a generous window; the views filter to their
  // own visible days. Recomputed whenever routines or the anchor change.
  readonly routineOccurrences = computed<RoutineOccurrence[]>(() => {
    const anchor = this.anchor();
    const from = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0);
    return occurrencesForRoutines(this.routines.routines(), from, to);
  });

  constructor() {
    effect(() => {
      const n = this.voice.wakeCount();
      if (n === 0) return;
      this.voice.playChime();
      this.wakeFlash.set(true);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.wakeFlash.set(false), 900);
    });

    // Whenever view or anchor changes, reload events for the visible range.
    // Briefing view doesn't need event data; skip the reload.
    effect(() => {
      const fam = this.family.family();
      if (!fam) return;
      const v = this.view();
      if (v === 'briefing') return;
      const { from, to } = rangeFor(v, this.anchor());
      void this.events.load(fam.id, { from, to });
    });
  }

  pickVoice(ev: Event): void {
    this.voice.setVoice((ev.target as HTMLSelectElement).value || null);
  }

  private fsListener = () => this.fullscreen.set(!!document.fullscreenElement);

  async ngOnInit(): Promise<void> {
    const tick = () => {
      const d = new Date();
      this.now.set(formatTime(d, this.family.timeZone()));
      this.nowDate.set(d);
    };
    tick();
    this.clockHandle = setInterval(tick, 60_000);
    document.addEventListener('fullscreenchange', this.fsListener);
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/sign-in'); return; }
      const [lists, accounts] = await Promise.all([
        this.lists.loadLists(fam.id),
        this.calendars.loadAccounts(fam.id),
        this.briefings.load(fam.id),
        this.routines.load(fam.id),
        // Loaded so voice intents can resolve immediately.
        this.inventory.load(fam.id).catch((e) => console.warn('inventory load failed', e)),
        this.waste.load(fam.id).catch((e) => console.warn('waste load failed', e)),
        this.meals.load(fam.id).catch((e) => console.warn('meals load failed', e)),
        this.recipeService.load(fam.id).catch((e) => console.warn('recipes load failed', e)),
        // Loaded so the free-form Q&A path has facts / context to ground on.
        this.facts.load(fam.id).catch((e) => console.warn('facts load failed', e)),
        this.contextNotes.load(fam.id).catch((e) => console.warn('context notes load failed', e)),
        this.profiles.load(fam.id).catch((e) => console.warn('profiles load failed', e)),
      ]);
      this.accountById.set(new Map(accounts.map((a) => [a.id, a])));
      const todo = lists.find((l) => l.kind === 'todo') ?? lists[0];
      if (todo) {
        this.activeListId.set(todo.id);
        await this.lists.loadItems(todo.id);
      }
    } catch {
      await this.router.navigateByUrl('/sign-in');
    }
  }

  ngOnDestroy(): void {
    if (this.clockHandle) clearInterval(this.clockHandle);
    this.stopWake?.();
    this.lists.unsubscribe();
    this.events.unsubscribe();
    this.briefings.unsubscribe();
    this.routines.unsubscribe();
    this.inventory.unsubscribe();
    this.waste.unsubscribe();
    this.meals.unsubscribe();
    this.recipeService.unsubscribe();
    this.facts.unsubscribe();
    this.contextNotes.unsubscribe();
    this.profiles.unsubscribe();
    document.removeEventListener('fullscreenchange', this.fsListener);
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (e) {
      console.warn('fullscreen toggle failed', e);
    }
  }

  enableVoice(): void {
    if (!this.voice.supported()) return;
    this.stopWake = this.voice.startWakeWord((command) => void this.handleCommand(command));
  }

  setView(v: CalView): void { this.view.set(v); }
  setAnchor(d: Date): void { this.anchor.set(d); }

  async setActiveList(id: string): Promise<void> {
    this.activeListId.set(id);
    await this.lists.loadItems(id);
  }

  private async handleCommand(transcript: string): Promise<void> {
    const fam = this.family.family();
    if (!fam || !transcript) return;
    this.showHeard(transcript);
    try {
      const res = await this.ai.runIntent({ transcript, family_id: fam.id, surface: 'display' });

      // Fallback: if ai-intent couldn't classify any intent confidently, hand
      // the transcript to the shared Q&A primitive so the display can answer
      // "what's on the grocery list?" / "when's the dentist?" naturally.
      const allUnknown = res.intents.length === 0
        || res.intents.every((i) => i.action === 'unknown');
      if (allUnknown) {
        const answered = await this.askFreeForm(transcript, fam.id);
        if (answered) return;
      }

      let overrideReply: string | null = null;
      for (const intent of res.intents) {
        if (intent.action === 'view.show_list' && intent.resolved_list_id) {
          await this.setActiveList(intent.resolved_list_id);
        } else if (intent.action === 'calendar.show') {
          this.setView(intent.view);
          if (intent.anchor_date) this.setAnchor(parseYmd(intent.anchor_date));
        } else if (intent.action === 'calendar.sync_all') {
          // Fire and forget — the model already produced a spoken_reply for the
          // user, and realtime will refresh the event list when sync writes new rows.
          void this.calendars.syncAll(fam.id);
        } else if (intent.action === 'inventory.out_of') {
          overrideReply = await this.handleInventoryOutOf(fam.id, intent.phrase) ?? overrideReply;
        } else if (intent.action === 'inventory.have') {
          overrideReply = await this.handleInventoryHave(fam.id, intent.phrase) ?? overrideReply;
        } else if (intent.action === 'inventory.query') {
          overrideReply = this.handleInventoryQuery(intent.phrase) ?? overrideReply;
        } else if (intent.action === 'waste.log') {
          overrideReply = await this.handleWasteLog(
            fam.id, intent.phrase,
            (intent.reason as any) ?? 'other',
            intent.percentage ?? 100,
          ) ?? overrideReply;
        } else if (intent.action === 'meal.cooked') {
          overrideReply = await this.handleMealCooked(fam.id, intent.recipe_name, intent.servings ?? null) ?? overrideReply;
        } else if (intent.action === 'meal.discarded') {
          overrideReply = await this.handleMealDiscarded(fam.id, intent.recipe_name, intent.servings_eaten ?? null) ?? overrideReply;
        }
      }
      const reply = overrideReply ?? res.spoken_reply;
      this.showReply(reply);
      this.voice.speak(reply);
    } catch (e: any) {
      this.showReply(`Sorry — ${e?.message ?? 'something went wrong'}`);
    }
  }

  // ===== Voice intent handlers =====

  /**
   * Free-form Q&A. Routes through the shared BrainDumpService.ask() primitive
   * so the display answers questions the same way the portal home page does.
   * Returns true if it produced a reply (regardless of mode).
   */
  private async askFreeForm(transcript: string, familyId: string): Promise<boolean> {
    try {
      const ctx: BrainDumpContext = {
        familyId,
        familyName: this.family.family()?.name,
        timezone: this.family.timeZone(),
        memberId: this.family.me()?.id ?? null,
        lists: this.lists.lists().map((l) => ({ id: l.id, name: l.name })),
        members: this.family.members().map((m) => ({ id: m.id, display_name: m.display_name })),
        profiles: this.profiles.profiles().map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
        snapshot: {
          items: this.lists.items().map((it) => ({
            list_name: this.lists.lists().find((l) => l.id === it.list_id)?.name ?? '',
            text: it.text, checked: it.checked,
          })),
          upcomingEvents: this.events.events().slice(0, 20).map((e) => ({
            title: e.title, starts_at: e.starts_at, location: e.location,
          })),
          facts: this.facts.facts().map((f) => ({
            key: f.key, value: f.value, category: f.category,
          })),
          contextNotes: this.contextNotes.notes().map((n) => ({
            content: n.content, note_type: n.type, expires_at: n.expires_at,
          })),
          routines: this.routines.routines().map((r) => ({
            name: r.name, next_due: r.next_due,
            cadence: r.cadence_type === 'interval'
              ? `every ${r.interval_days} days`
              : r.cadence_rrule ?? '',
          })),
          recipes: this.recipeService.recipes().map((r) => ({ title: r.title })),
          inventory: this.inventory.activeItems().map((i) => ({
            name: i.name, in_stock: i.in_stock,
            category: this.inventory.categories().find((c) => c.id === i.category_id)?.name ?? 'Misc',
          })),
        },
      };
      const answer = await this.brainDump.ask(transcript, ctx);
      const reply = answer.reply || `I couldn't find anything about that.`;
      this.showReply(reply);
      this.voice.speak(reply);
      return true;
    } catch (e) {
      console.warn('ask fallback failed', e);
      return false;
    }
  }

  /**
   * "We're out of soy sauce" — resolve via D2 ladder, mark item out of stock,
   * and add a corresponding entry to the grocery list. Returns a spoken reply
   * tailored to which branch of the ladder fired.
   */
  private async handleInventoryOutOf(familyId: string, phrase: string): Promise<string | null> {
    const resolution = this.inventory.resolveForVoice(phrase);
    const grocery = this.lists.lists().find((l) => l.kind === 'grocery');
    const meId = this.family.me()?.id ?? null;

    if (resolution.kind === 'item') {
      await this.inventory.setInStock(resolution.item, false, { source: 'voice', memberId: meId });
      if (grocery) {
        await this.lists.addItem(grocery.id, resolution.item.name, familyId, meId);
      }
      return `Marked ${resolution.item.name} out and added it to the grocery list.`;
    }
    if (resolution.kind === 'category') {
      if (grocery) {
        await this.lists.addItem(grocery.id, resolution.name, familyId, meId);
      }
      return `Added ${resolution.name} to the grocery list.`;
    }
    // No match → add to grocery under Misc.
    if (grocery) {
      await this.lists.addItem(grocery.id, resolution.name, familyId, meId);
    }
    return `Added ${resolution.name} to the grocery list.`;
  }

  /** "We just bought bread" — mark the matched item back in stock. */
  private async handleInventoryHave(_familyId: string, phrase: string): Promise<string | null> {
    const resolution = this.inventory.resolveForVoice(phrase);
    const meId = this.family.me()?.id ?? null;
    if (resolution.kind === 'item') {
      await this.inventory.setInStock(resolution.item, true, { source: 'voice', memberId: meId });
      return `${capitalize(resolution.item.name)} is back in stock.`;
    }
    // Unmatched: nothing to update — just acknowledge.
    return `Noted, but I don't have ${phrase} tracked yet — add it on the Inventory page.`;
  }

  /** "Do we have eggs?" — read-only resolution lookup. */
  private handleInventoryQuery(phrase: string): string | null {
    const resolution = this.inventory.resolveForVoice(phrase);
    if (resolution.kind === 'item') {
      const item = resolution.item;
      if (item.in_stock) {
        const qty = item.quantity_count != null ? ` (${item.quantity_count} on hand)` : '';
        return `Yes — ${item.name} is in stock${qty}.`;
      }
      return `No — ${item.name} is marked out.`;
    }
    if (resolution.kind === 'category') {
      return `Nothing tracked under ${resolution.category.name} yet.`;
    }
    return `I don't have ${phrase} on the inventory list.`;
  }

  /** "We threw out the moldy bread" — log a waste event. */
  private async handleWasteLog(
    familyId: string, phrase: string,
    reason: 'spoiled' | 'disliked' | 'leftover_not_eaten' | 'accident' | 'not_worth_it' | 'other',
    percentage: number,
  ): Promise<string | null> {
    const resolution = this.inventory.resolveForVoice(phrase);
    const meId = this.family.me()?.id ?? null;
    const itemId = resolution.kind === 'item' ? resolution.item.id : null;
    const estValue = resolution.kind === 'item' && resolution.item.typical_price_cents != null
      ? Math.round((percentage / 100) * (resolution.item.typical_price_cents as number))
      : null;
    await this.waste.log({
      familyId, itemId,
      freeTextName: itemId ? null : phrase,
      reason, percentage,
      estimatedValueCents: estValue,
      source: 'voice', memberId: meId,
    });
    return `Logged ${phrase} as waste.`;
  }

  /** "I made lasagna" — log a meal_event tied to the recipe if found. */
  private async handleMealCooked(familyId: string, recipeName: string, servings: number | null): Promise<string | null> {
    const meId = this.family.me()?.id ?? null;
    const recipe = this.findRecipeByName(recipeName);
    await this.meals.logCooked({
      familyId,
      recipeId: recipe?.id ?? null,
      recipeName: recipe?.title ?? recipeName,
      servingsMade: servings ?? recipe?.servings ?? null,
      estimatedTotalCostCents: recipe?.estimated_cost_cents ?? null,
      memberId: meId,
      source: 'voice',
    });
    return `Logged ${recipe?.title ?? recipeName}.`;
  }

  /** "We threw out the lasagna leftovers" — close the loop on a recent meal. */
  private async handleMealDiscarded(familyId: string, recipeName: string, servingsEaten: number | null): Promise<string | null> {
    const meId = this.family.me()?.id ?? null;
    const recipe = this.findRecipeByName(recipeName);
    await this.meals.recordDiscard({
      familyId,
      recipeName: recipe?.title ?? recipeName,
      servingsEaten,
      memberId: meId,
      source: 'voice',
    });
    return `Logged ${recipe?.title ?? recipeName} leftovers as discarded.`;
  }

  private findRecipeByName(name: string) {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    return this.recipeService.recipes().find((r) => r.title.toLowerCase() === n)
      ?? this.recipeService.recipes().find((r) => r.title.toLowerCase().includes(n))
      ?? null;
  }

  memberColor(item: ListItemRow): string {
    const m = this.family.members().find((x) => x.id === item.added_by_member_id);
    return m?.color ?? 'var(--accent)';
  }
  colorFor(e: EventRow): string {
    if (e.source_account_id) {
      const acc = this.accountById().get(e.source_account_id);
      if (acc?.color) return acc.color;
    }
    if (e.owner_member_id) {
      const m = this.family.members().find((x) => x.id === e.owner_member_id);
      if (m?.color) return m.color;
    }
    return 'var(--accent)';
  }

  private showHeard(text: string): void {
    this.heard.set(text);
    if (this.heardTimer) clearTimeout(this.heardTimer);
    this.heardTimer = setTimeout(() => this.heard.set(null), 3500);
  }
  private showReply(text: string): void {
    this.reply.set(text);
    if (this.replyTimer) clearTimeout(this.replyTimer);
    this.replyTimer = setTimeout(() => this.reply.set(null), 4500);
  }
}

/**
 * Render short all-caps names as initialisms with dots ("HARSH" → "H.A.R.S.H.").
 * Anything mixed-case or longer than 7 chars passes through unchanged.
 */
function acronymize(name: string): string {
  if (name.length === 0 || name.length > 7) return name;
  const letters = name.replace(/\s/g, '');
  if (letters !== letters.toUpperCase() || !/^[A-Z]+$/.test(letters)) return name;
  return letters.split('').join('.') + '.';
}

function formatTime(d: Date, tz?: string): string {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rangeFor(view: CalView, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  // month: include leading/trailing days from the 6-week grid
  return { from: startOfMonthGrid(anchor), to: endOfMonthGrid(anchor) };
}
