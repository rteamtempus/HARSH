import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventRow } from 'data-access';
import { addDays, sameDay, startOfWeek } from '../date-utils';

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);
const TOTAL_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

interface WeekDay { date: Date; allDay: EventRow[]; timed: EventRow[] }

@Component({
  selector: 'harsh-week-view',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './week-view.component.html',
  styleUrl: './week-view.component.scss',
})
export class WeekViewComponent {
  readonly events = input.required<EventRow[]>();
  readonly anchor = input.required<Date>();
  readonly now = input.required<Date>();
  readonly colorFor = input.required<(e: EventRow) => string>();

  readonly hours = HOURS;

  readonly days = computed<WeekDay[]>(() => {
    const start = startOfWeek(this.anchor());
    const all = this.events();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const dayEvents = all.filter((e) => sameDay(new Date(e.starts_at), date));
      return {
        date,
        allDay: dayEvents.filter((e) => e.all_day),
        timed: dayEvents.filter((e) => !e.all_day).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      };
    });
  });

  readonly anyAllDay = computed(() => this.days().some((d) => d.allDay.length > 0));

  readonly nowInRange = computed(() => {
    const n = this.now();
    const inWeek = this.days().some((d) => sameDay(d.date, n));
    if (!inWeek) return false;
    const m = this.minutesFromStart(n);
    return m >= 0 && m <= TOTAL_MIN;
  });
  readonly nowPct = computed(() => (this.minutesFromStart(this.now()) / TOTAL_MIN) * 100);

  formatHour(h: number): string {
    if (h === 0 || h === 24) return '12a';
    if (h === 12) return '12p';
    return h < 12 ? `${h}a` : `${h - 12}p`;
  }

  topPct(e: EventRow): number {
    return Math.max(0, (this.minutesFromStart(new Date(e.starts_at)) / TOTAL_MIN) * 100);
  }
  heightPct(e: EventRow): number {
    const start = new Date(e.starts_at).getTime();
    const end = e.ends_at ? new Date(e.ends_at).getTime() : start + 60 * 60_000;
    const durMin = Math.max(15, (end - start) / 60_000);
    const top = this.topPct(e);
    return Math.min(100 - top, (durMin / TOTAL_MIN) * 100);
  }

  isToday(d: Date): boolean { return sameDay(d, this.now()); }

  private minutesFromStart(d: Date): number {
    return d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
  }
}
