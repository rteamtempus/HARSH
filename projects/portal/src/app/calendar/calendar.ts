import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CalendarAccountRow,
  CalendarService,
  EventRow,
  EventService,
  FamilyService,
} from 'data-access';

interface DayGroup {
  key: string;
  date: Date;
  events: EventRow[];
}

@Component({
  selector: 'harsh-calendar',
  standalone: true,
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <header>
        <div>
          <a routerLink="/" class="back">← Home</a>
          <h1>Calendar</h1>
        </div>
        <a routerLink="/settings" class="ghost">Manage calendars</a>
      </header>

      @if (events.events().length === 0) {
        <p class="empty">
          No events yet. @if (calendars.accounts().length === 0) {
            Connect a calendar in <a routerLink="/settings">Settings</a> to get started.
          } @else {
            Nothing scheduled in the next 60 days.
          }
        </p>
      } @else {
        <ul class="days">
          @for (day of grouped(); track day.key) {
            <li>
              <header class="day-head">
                <div class="day-num">{{ day.date | date:'d' }}</div>
                <div>
                  <div class="day-name">{{ day.date | date:'EEEE' }}</div>
                  <div class="day-sub">{{ day.date | date:'MMMM y' }}</div>
                </div>
              </header>
              <ul class="events">
                @for (e of day.events; track e.id) {
                  <li class="event" [style.--cal-color]="colorFor(e)">
                    <div class="time">
                      @if (e.all_day) { all day }
                      @else { {{ e.starts_at | date:'h:mm a' }} }
                    </div>
                    <div class="body">
                      <div class="title">{{ e.title }}</div>
                      @if (e.location) { <div class="meta">{{ e.location }}</div> }
                      @if (sourceLabel(e); as src) { <div class="meta src">{{ src }}</div> }
                    </div>
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:42rem; margin:0 auto; padding:var(--s-6) var(--s-5) var(--s-9); }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:var(--s-3); margin-bottom:var(--s-6); }
    .back { color:var(--text-tertiary); text-decoration:none; font-size:var(--fs-small); display:block; margin-bottom:var(--s-1); }
    .back:hover { color:var(--accent); }
    h1 { margin:0; font-family:var(--font-display); font-size:var(--fs-h1); }
    .ghost { background:transparent; border:1px solid var(--line-default); padding:var(--s-2) var(--s-3); border-radius:var(--r-md); cursor:pointer; color:var(--text-primary); font-size:var(--fs-small); text-decoration:none; }
    .ghost:hover { border-color:var(--accent); color:var(--accent); }
    .empty { color:var(--text-tertiary); font-style:italic; padding:var(--s-7) 0; text-align:center; }
    .empty a { color:var(--accent); }
    .days { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-6); }
    .day-head { display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-3); padding-bottom:var(--s-2); border-bottom:1px solid var(--line-subtle); }
    .day-num { font-family:var(--font-display); font-size:2.5rem; font-weight:600; line-height:1; color:var(--text-secondary); min-width:2.5rem; text-align:center; }
    .day-name { font-weight:600; font-size:var(--fs-body); }
    .day-sub { font-size:var(--fs-small); color:var(--text-tertiary); }
    .events { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .event { display:flex; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-3) var(--s-4); border-radius:var(--r-md); border:1px solid var(--line-subtle); border-left:4px solid var(--cal-color, var(--accent)); box-shadow:var(--shadow-sm); }
    .time { width:6rem; font-size:var(--fs-small); color:var(--text-secondary); padding-top:0.15rem; font-variant-numeric:tabular-nums; }
    .body { flex:1; }
    .title { font-weight:600; }
    .meta { font-size:var(--fs-small); color:var(--text-tertiary); }
    .meta.src { font-size:var(--fs-micro); margin-top:0.15rem; }
  `],
})
export class CalendarComponent implements OnInit, OnDestroy {
  protected readonly events = inject(EventService);
  protected readonly calendars = inject(CalendarService);
  protected readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly grouped = computed<DayGroup[]>(() => groupByDay(this.events.events()));

  private accountById = signal<Map<string, CalendarAccountRow>>(new Map());

  async ngOnInit(): Promise<void> {
    const fam = this.family.family() ?? (await this.family.loadCurrent());
    if (!fam) { await this.router.navigateByUrl('/setup'); return; }
    const accounts = await this.calendars.loadAccounts(fam.id);
    this.accountById.set(new Map(accounts.map((a) => [a.id, a])));
    await this.events.load(fam.id);
  }

  ngOnDestroy(): void { this.events.unsubscribe(); }

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
  sourceLabel(e: EventRow): string | null {
    if (e.source_account_id) {
      const acc = this.accountById().get(e.source_account_id);
      return acc?.name ?? null;
    }
    return null;
  }
}

function groupByDay(events: EventRow[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const e of events) {
    const d = new Date(e.starts_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [] };
      groups.set(key, g);
    }
    g.events.push(e);
  }
  return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}
