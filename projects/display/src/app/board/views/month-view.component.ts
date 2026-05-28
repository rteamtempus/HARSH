import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventRow, RoutineOccurrence } from 'data-access';
import { addDays, sameDay, startOfMonthGrid } from '../date-utils';

function formatChipTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hr}${am ? 'a' : 'p'}` : `${hr}:${String(m).padStart(2, '0')}${am ? 'a' : 'p'}`;
}

interface Cell { date: Date; events: EventRow[]; routines: RoutineOccurrence[]; inMonth: boolean }

@Component({
  selector: 'harsh-month-view',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './month-view.component.html',
  styleUrl: './month-view.component.scss',
})
export class MonthViewComponent {
  readonly events = input.required<EventRow[]>();
  readonly routines = input<RoutineOccurrence[]>([]);
  readonly anchor = input.required<Date>();
  readonly colorFor = input.required<(e: EventRow) => string>();

  readonly weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly cells = computed<Cell[]>(() => {
    const a = this.anchor();
    const start = startOfMonthGrid(a);
    const month = a.getMonth();
    const all = this.events();
    const occ = this.routines();
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      const events = all
        .filter((e) => sameDay(new Date(e.starts_at), date))
        .sort((x, y) => x.starts_at.localeCompare(y.starts_at));
      const routines = occ.filter((r) => sameDay(r.date, date));
      return { date, events, routines, inMonth: date.getMonth() === month };
    });
  });

  readonly rows = computed(() => Math.ceil(this.cells().length / 7));

  isToday(d: Date): boolean { return sameDay(d, new Date()); }

  chipTime(iso: string): string { return formatChipTime(iso); }
}
