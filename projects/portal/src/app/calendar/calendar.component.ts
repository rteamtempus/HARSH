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
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.scss',
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
