import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AiService,
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
import { DayViewComponent } from './views/day-view';
import { WeekViewComponent } from './views/week-view';
import { MonthViewComponent } from './views/month-view';
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

export type CalView = 'day' | 'week' | 'month';

@Component({
  selector: 'harsh-board',
  standalone: true,
  imports: [DayViewComponent, WeekViewComponent, MonthViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <header [class.wake-flash]="wakeFlash()">
        <h1 class="harsh">{{ familyDisplayName() }}</h1>
        <div class="meta">
          @if (voice.capturingCommand()) {
            <span class="capture-pill"><span class="dot-live big"></span> Listening…</span>
          } @else if (wakeFlash()) {
            <span class="capture-pill"><span class="dot-live big"></span> Heard you!</span>
          }
          <span class="clock mono">{{ now() }}</span>
          <button class="menu-btn" (click)="menuOpen.set(!menuOpen())" aria-label="Menu">
            <span class="menu-icon"></span>
          </button>
        </div>

        @if (menuOpen()) {
          <div class="menu-backdrop" (click)="menuOpen.set(false)"></div>
          <div class="menu" role="dialog">
            <h3>Display</h3>
            <div class="row">
              <label>View</label>
              <div class="seg">
                <button [class.active]="view() === 'day'" (click)="setView('day')">Day</button>
                <button [class.active]="view() === 'week'" (click)="setView('week')">Week</button>
                <button [class.active]="view() === 'month'" (click)="setView('month')">Month</button>
              </div>
            </div>
            <div class="row">
              <label>Theme</label>
              <div class="seg">
                <button [class.active]="theme.state().mode === 'light'" (click)="theme.apply({ mode: 'light' })">Light</button>
                <button [class.active]="theme.state().mode === 'dark'" (click)="theme.apply({ mode: 'dark' })">Dark</button>
              </div>
            </div>
            <div class="row">
              <label>Full screen</label>
              <button class="primary small" (click)="toggleFullscreen()">
                {{ fullscreen() ? 'Exit' : 'Enter' }}
              </button>
            </div>

            <h3>Voice</h3>
            <div class="row">
              <label>Wake word</label>
              @if (!voice.wakeArmed() && voice.supported()) {
                <button class="primary small" (click)="enableVoice()">Enable “Hey HARSH”</button>
              } @else if (voice.wakeArmed()) {
                <span class="status"><span class="dot-live"></span> Listening</span>
              } @else {
                <span class="status muted">Not supported</span>
              }
            </div>
            @if (voice.voices().length > 0) {
              <div class="row">
                <label>Voice</label>
                <select [value]="voice.selectedVoiceName() ?? ''" (change)="pickVoice($event)">
                  <option value="">Default</option>
                  @for (v of voice.voices(); track v.name) {
                    <option [value]="v.name">{{ v.name }}</option>
                  }
                </select>
              </div>
            }
          </div>
        }
      </header>

      <div class="cols">
        <section class="cal">
          @if (view() === 'day') {
            <harsh-day-view [events]="events.events()" [anchor]="anchor()" [now]="nowDate()" [colorFor]="colorForFn" />
          } @else if (view() === 'week') {
            <harsh-week-view [events]="events.events()" [anchor]="anchor()" [now]="nowDate()" [colorFor]="colorForFn" />
          } @else {
            <harsh-month-view [events]="events.events()" [anchor]="anchor()" [colorFor]="colorForFn" />
          }
        </section>

        <aside class="lists-side">
          <nav class="list-tabs">
            @for (l of lists.lists(); track l.id) {
              <button [class.active]="activeListId() === l.id" (click)="setActiveList(l.id)">{{ l.name }}</button>
            }
          </nav>
          @if (activeList(); as list) {
            <ul class="list-items">
              @for (item of openItems(); track item.id) {
                <li class="list-item" [style.--member-color]="memberColor(item)">
                  <span class="dot"></span>
                  <span class="text">{{ item.text }}</span>
                </li>
              } @empty {
                <li class="list-empty">All clear on {{ list.name.toLowerCase() }}.</li>
              }
            </ul>
            @if (checkedItems().length > 0) {
              <p class="checked-count">{{ checkedItems().length }} done</p>
            }
          }
        </aside>
      </div>

      @if (heard(); as h) { <p class="heard">“{{ h }}”</p> }
      @if (reply(); as r) { <p class="reply">{{ r }}</p> }
    </main>
  `,
  styles: [`
    :host { display:block; height:100dvh; background:var(--bg-canvas); color:var(--text-primary); position:relative; }
    main { display:flex; flex-direction:column; height:100%; padding:var(--s-4) var(--s-5); gap:var(--s-3); min-height:0; }
    header { display:flex; align-items:center; justify-content:space-between; padding-bottom:var(--s-2); border-bottom:1px solid var(--line-default); flex:0 0 auto; gap:var(--s-4); position:relative; }
    .harsh { margin:0; font-family:var(--font-display); font-size:clamp(2rem, 4vw, 3.5rem); letter-spacing:0.02em; line-height:1; font-weight:600; }
    .meta { display:flex; align-items:center; gap:var(--s-3); }
    .clock { color:var(--text-secondary); font-size:1.2rem; font-variant-numeric:tabular-nums; }
    .capture-pill { display:inline-flex; align-items:center; gap:var(--s-2); color:var(--gold); font-size:0.85rem; font-weight:600; }
    .menu-btn { width:2rem; height:2rem; border-radius:var(--r-sm); background:transparent; border:1px solid var(--line-default); cursor:pointer; display:grid; place-items:center; padding:0; }
    .menu-btn:hover { border-color:var(--accent); }
    .menu-icon, .menu-icon::before, .menu-icon::after { content:''; display:block; width:1rem; height:2px; background:var(--text-primary); position:relative; }
    .menu-icon::before, .menu-icon::after { position:absolute; left:0; }
    .menu-icon::before { top:-5px; }
    .menu-icon::after { top:5px; }
    .menu-backdrop { position:fixed; inset:0; z-index:20; }
    .menu { position:absolute; top:calc(100% + var(--s-2)); right:0; min-width:18rem; background:var(--bg-raised); border:1px solid var(--line-default); border-radius:var(--r-md); padding:var(--s-3) var(--s-4); box-shadow:var(--shadow-lg); z-index:21; display:flex; flex-direction:column; gap:var(--s-3); }
    .menu h3 { font-family:var(--font-display); font-size:1rem; margin:0; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.06em; }
    .menu .row { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); }
    .menu .row label { color:var(--text-tertiary); font-size:0.85rem; }
    .menu .seg { display:flex; gap:2px; background:var(--bg-surface); padding:2px; border-radius:var(--r-pill); border:1px solid var(--line-subtle); }
    .menu .seg button { background:transparent; border:0; color:var(--text-secondary); padding:var(--s-1) var(--s-3); border-radius:var(--r-pill); cursor:pointer; font-size:0.8rem; font-weight:500; }
    .menu .seg button.active { background:var(--accent); color:var(--text-on-accent); }
    .menu select { padding:var(--s-1) var(--s-2); border-radius:var(--r-sm); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); font-size:0.8rem; max-width:11rem; }
    .menu .primary { background:var(--accent); color:var(--text-on-accent); border:0; padding:var(--s-1) var(--s-3); border-radius:var(--r-md); cursor:pointer; font-size:0.8rem; font-weight:600; }
    .menu .status { display:inline-flex; align-items:center; gap:var(--s-2); color:var(--text-secondary); font-size:0.85rem; }
    .menu .status.muted { color:var(--text-tertiary); }
    .dot-live { width:0.6rem; height:0.6rem; background:var(--danger); border-radius:50%; animation:pulse 1.4s ease-in-out infinite; }
    .dot-live.big { width:0.8rem; height:0.8rem; background:var(--gold); animation:flashDot 0.9s var(--ease-out); }
    @keyframes flashDot { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(1.6); opacity:0.7; } }
    header.wake-flash { animation:headerFlash 0.9s var(--ease-out); }
    @keyframes headerFlash { 0%,100% { background:transparent; } 50% { background:var(--gold-soft); } }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

    .cols { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0, 1fr) 22rem; gap:var(--s-5); }
    .cal { min-height:0; display:flex; flex-direction:column; }
    .lists-side { display:flex; flex-direction:column; gap:var(--s-3); background:var(--bg-surface); padding:var(--s-4); border-radius:var(--r-lg); border:1px solid var(--line-subtle); min-width:0; min-height:0; overflow:hidden; }
    .list-tabs { display:flex; gap:var(--s-2); flex-wrap:wrap; flex:0 0 auto; }
    .list-tabs button { background:transparent; color:var(--text-secondary); border:1px solid var(--line-subtle); padding:var(--s-1) var(--s-3); border-radius:var(--r-pill); cursor:pointer; font-size:var(--fs-small); font-weight:500; font-family:var(--font-sans); }
    .list-tabs button:hover { color:var(--text-primary); border-color:var(--line-default); }
    .list-tabs button.active { background:var(--accent); color:var(--text-on-accent); border-color:var(--accent); }
    .list-items { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); flex:1; min-height:0; overflow:hidden; }
    .list-item { display:flex; align-items:center; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-3); border-radius:var(--r-md); border:1px solid var(--line-subtle); flex:0 0 auto; min-width:0; }
    .list-item .dot { width:0.7rem; height:0.7rem; border-radius:var(--r-pill); background:var(--member-color, var(--accent)); flex:none; }
    .list-item .text { font-size:var(--fs-body); line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
    .list-empty { color:var(--text-tertiary); font-style:italic; padding:var(--s-3) 0; font-size:var(--fs-small); }
    .checked-count { color:var(--text-tertiary); font-size:var(--fs-small); margin:var(--s-2) 0 0; flex:0 0 auto; }

    .heard, .reply { position:fixed; left:50%; transform:translateX(-50%); padding:var(--s-3) var(--s-5); border-radius:var(--r-pill); box-shadow:var(--shadow-lg); font-size:var(--fs-body); animation:fadeIn var(--dur-base) var(--ease-out); }
    .heard { bottom:var(--s-8); background:var(--bg-raised); color:var(--text-secondary); font-style:italic; }
    .reply { bottom:var(--s-5); background:var(--accent); color:var(--text-on-accent); font-weight:600; }
    @keyframes fadeIn { from { opacity:0; transform:translate(-50%, 4px); } to { opacity:1; transform:translate(-50%, 0); } }
  `],
})
export class BoardComponent implements OnInit, OnDestroy {
  protected readonly family = inject(FamilyService);
  protected readonly lists = inject(ListService);
  protected readonly events = inject(EventService);
  protected readonly calendars = inject(CalendarService);
  protected readonly voice = inject(VoiceService);
  protected readonly theme = inject(ThemeService);
  private readonly ai = inject(AiService);
  private readonly router = inject(Router);

  readonly now = signal('');
  readonly nowDate = signal(new Date());
  readonly view = signal<CalView>('week');
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
    effect(() => {
      const fam = this.family.family();
      if (!fam) return;
      const { from, to } = rangeFor(this.view(), this.anchor());
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
      ]);
      this.accountById.set(new Map(accounts.map((a) => [a.id, a])));
      const todo = lists.find((l) => l.kind === 'todo') ?? lists[0];
      if (todo) {
        this.activeListId.set(todo.id);
        await this.lists.loadItems(todo.id);
      }
      // Events load via the effect above when view/anchor are initialized.
    } catch {
      await this.router.navigateByUrl('/sign-in');
    }
  }

  ngOnDestroy(): void {
    if (this.clockHandle) clearInterval(this.clockHandle);
    this.stopWake?.();
    this.lists.unsubscribe();
    this.events.unsubscribe();
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
