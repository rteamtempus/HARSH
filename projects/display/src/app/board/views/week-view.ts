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
  template: `
    <div class="view">
      <div class="view-head">
        <div class="title">Week of {{ days()[0].date | date:'MMMM d' }}</div>
      </div>

      <div class="day-headers">
        <div class="hours-spacer"></div>
        @for (d of days(); track d.date.getTime()) {
          <div class="day-header" [class.today]="isToday(d.date)">
            <span class="dow">{{ d.date | date:'EEE' }}</span>
            <span class="num">{{ d.date | date:'d' }}</span>
          </div>
        }
      </div>

      @if (anyAllDay()) {
        <div class="all-day-row">
          <div class="hours-spacer label">All day</div>
          @for (d of days(); track d.date.getTime()) {
            <div class="all-day-col">
              @for (e of d.allDay; track e.id) {
                <span class="all-day-chip" [style.--cal-color]="colorFor()(e)">{{ e.title }}</span>
              }
            </div>
          }
        </div>
      }

      <div class="time-grid">
        <div class="hours">
          @for (h of hours; track h) {
            <div class="hour-cell">{{ formatHour(h) }}</div>
          }
        </div>
        @for (d of days(); track d.date.getTime()) {
          <div class="day-col" [class.today]="isToday(d.date)">
            @for (h of hours; track h) { <div class="hour-line"></div> }
            @for (e of d.timed; track e.id) {
              <div class="event"
                   [style.--cal-color]="colorFor()(e)"
                   [style.top.%]="topPct(e)"
                   [style.height.%]="heightPct(e)">
                <div class="evt-time">{{ e.starts_at | date:'h:mma' }}</div>
                <div class="evt-title">{{ e.title }}</div>
              </div>
            }
          </div>
        }
        @if (nowInRange()) {
          <div class="now-line" [style.top.%]="nowPct()">
            <span class="now-dot"></span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; }
    .view { display:flex; flex-direction:column; height:100%; min-height:0; gap:var(--s-2); }
    .view-head { padding-bottom:var(--s-1); border-bottom:1px solid var(--line-subtle); flex:0 0 auto; }
    .title { font-family:var(--font-display); font-size:1.25rem; }

    .day-headers, .all-day-row {
      display:grid; grid-template-columns:3rem repeat(7, minmax(0, 1fr));
      gap:var(--s-1); flex:0 0 auto;
    }
    .day-header { display:flex; flex-direction:column; align-items:center; padding:0.2rem 0; font-size:0.8rem; }
    .day-header.today { color:var(--accent); font-weight:600; }
    .day-header .dow { font-size:0.7rem; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.05em; }
    .day-header .num { font-family:var(--font-display); font-size:1.1rem; line-height:1; }
    .hours-spacer { font-size:0.7rem; color:var(--text-tertiary); display:flex; align-items:center; justify-content:flex-end; padding-right:var(--s-1); }
    .hours-spacer.label { text-transform:uppercase; letter-spacing:0.05em; }

    .all-day-row { padding:0.2rem 0; border-bottom:1px solid var(--line-subtle); min-height:0; }
    .all-day-col { display:flex; flex-direction:column; gap:0.15rem; min-width:0; min-height:0; overflow:hidden; }
    .all-day-chip {
      background:var(--bg-raised); border-left:3px solid var(--cal-color, var(--accent));
      padding:0.1rem 0.3rem; border-radius:var(--r-sm); font-size:0.75rem; font-weight:500;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }

    .time-grid {
      flex:1; min-height:0; display:grid;
      grid-template-columns:3rem repeat(7, minmax(0, 1fr));
      gap:var(--s-1);
      position:relative;
      overflow:hidden;
    }
    .hours { display:flex; flex-direction:column; min-height:0; }
    .hour-cell { flex:1; min-height:0; font-size:0.65rem; color:var(--text-tertiary); padding-top:2px; text-align:right; padding-right:var(--s-1); }
    .day-col {
      position:relative; min-height:0; background:var(--bg-surface);
      border-radius:var(--r-sm); border:1px solid var(--line-subtle);
      display:flex; flex-direction:column; overflow:hidden;
    }
    .day-col.today { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
    .hour-line { flex:1; min-height:0; border-top:1px dashed var(--line-subtle); }
    .hour-line:first-child { border-top:none; }

    .event {
      position:absolute;
      left:2px; right:2px;
      container-type:size;
      background:var(--bg-raised);
      border-left:3px solid var(--cal-color, var(--accent));
      border-radius:var(--r-sm);
      padding:0.15rem 0.3rem;
      overflow:hidden;
      display:flex; flex-direction:column; gap:1px;
      min-height:1rem;
    }
    .evt-time { color:var(--text-tertiary); font-variant-numeric:tabular-nums; font-size:clamp(0.5rem, 16cqh, 0.7rem); white-space:nowrap; }
    .evt-title { font-weight:500; font-size:clamp(0.6rem, 28cqh, 0.9rem); line-height:1.1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }

    /* Now line spans across all 7 day columns but skips the hours column. */
    .now-line {
      position:absolute;
      left:calc(3rem + var(--s-1));
      right:0;
      height:2px;
      background:var(--danger);
      z-index:5;
      pointer-events:none;
    }
    .now-dot {
      position:absolute; left:-5px; top:-4px;
      width:10px; height:10px; background:var(--danger);
      border-radius:50%;
    }
  `],
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
