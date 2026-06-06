import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CalendarAccountRow,
  CalendarService,
  EventRow,
  EventService,
  FamilyService,
  RoutineService,
  occurrencesForRoutines,
} from 'data-access';
import { HeaderComponent } from '../header/header.component';

interface RoutineChip { name: string; category: string | null }
interface DayGroup {
  key: string;
  date: Date;
  events: EventRow[];
  routines: RoutineChip[];
}

@Component({
  selector: 'harsh-calendar',
  standalone: true,
  imports: [DatePipe, RouterLink, HeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.scss',
})
export class CalendarComponent implements OnInit, OnDestroy {
  protected readonly events = inject(EventService);
  protected readonly calendars = inject(CalendarService);
  protected readonly family = inject(FamilyService);
  protected readonly routines = inject(RoutineService);
  private readonly router = inject(Router);

  readonly grouped = computed<DayGroup[]>(() => this.buildGroups());

  private accountById = signal<Map<string, CalendarAccountRow>>(new Map());

  async ngOnInit(): Promise<void> {
    const fam = this.family.family() ?? (await this.family.loadCurrent());
    if (!fam) { await this.router.navigateByUrl('/setup'); return; }
    const accounts = await this.calendars.loadAccounts(fam.id);
    this.accountById.set(new Map(accounts.map((a) => [a.id, a])));
    await Promise.all([this.events.load(fam.id), this.routines.load(fam.id)]);
  }

  ngOnDestroy(): void {
    this.events.unsubscribe();
    this.routines.unsubscribe();
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
  sourceLabel(e: EventRow): string | null {
    if (e.source_account_id) {
      const acc = this.accountById().get(e.source_account_id);
      return acc?.name ?? null;
    }
    return null;
  }

  /** Merge events + routine occurrences into per-day groups. */
  private buildGroups(): DayGroup[] {
    const groups = new Map<string, DayGroup>();
    const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const ensure = (d: Date): DayGroup => {
      const k = keyOf(d);
      let g = groups.get(k);
      if (!g) {
        g = { key: k, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [], routines: [] };
        groups.set(k, g);
      }
      return g;
    };

    for (const e of this.events.events()) {
      ensure(new Date(e.starts_at)).events.push(e);
    }

    // Routine occurrences across the same window the event list spans
    // (now → +60 days, matching EventService default).
    const from = new Date();
    const to = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    for (const occ of occurrencesForRoutines(this.routines.routines(), from, to)) {
      ensure(occ.date).routines.push({ name: occ.name, category: occ.category });
    }

    return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}
