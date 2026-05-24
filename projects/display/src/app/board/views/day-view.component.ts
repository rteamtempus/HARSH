import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventRow } from 'data-access';
import { sameDay } from '../date-utils';

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);
const TOTAL_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

@Component({
  selector: 'harsh-day-view',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './day-view.component.html',
  styleUrl: './day-view.component.scss',
})
export class DayViewComponent {
  readonly events = input.required<EventRow[]>();
  readonly anchor = input.required<Date>();
  readonly now = input.required<Date>();
  readonly colorFor = input.required<(e: EventRow) => string>();

  readonly hours = HOURS;

  readonly relevant = computed(() => this.events().filter((e) => sameDay(new Date(e.starts_at), this.anchor())));
  readonly allDay = computed(() => this.relevant().filter((e) => e.all_day));
  readonly timed = computed(() => this.relevant().filter((e) => !e.all_day).sort((a, b) => a.starts_at.localeCompare(b.starts_at)));

  readonly nowInRange = computed(() => sameDay(this.now(), this.anchor()) && this.minutesFromStart(this.now()) >= 0 && this.minutesFromStart(this.now()) <= TOTAL_MIN);
  readonly nowPct = computed(() => (this.minutesFromStart(this.now()) / TOTAL_MIN) * 100);

  formatHour(h: number): string {
    if (h === 0 || h === 24) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
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

  private minutesFromStart(d: Date): number {
    return d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
  }
}
