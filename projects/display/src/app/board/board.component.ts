import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AiService,
  BriefingService,
  CalendarAccountRow,
  CalendarService,
  EventRow,
  EventService,
  FamilyService,
  ListItemRow,
  ListRow,
  ListService,
  ThemeService,
  VoiceService,
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
  private readonly ai = inject(AiService);
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
        }
      }
      this.showReply(res.spoken_reply);
      this.voice.speak(res.spoken_reply);
    } catch (e: any) {
      this.showReply(`Sorry — ${e?.message ?? 'something went wrong'}`);
    }
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

function rangeFor(view: CalView, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  // month: include leading/trailing days from the 6-week grid
  return { from: startOfMonthGrid(anchor), to: endOfMonthGrid(anchor) };
}
