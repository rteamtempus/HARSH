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
  template: `
    <div class="view">
      <div class="view-head">
        <div class="day-line">
          <span class="big-day">{{ anchor() | date:'EEEE' }}</span>
          <span class="big-date">{{ anchor() | date:'MMMM d, y' }}</span>
        </div>
      </div>

      @if (allDay().length > 0) {
        <div class="all-day-strip">
          <span class="strip-label">All day</span>
          <div class="strip-events">
            @for (e of allDay(); track e.id) {
              <span class="all-day-chip" [style.--cal-color]="colorFor()(e)">{{ e.title }}</span>
            }
          </div>
        </div>
      }

      <div class="time-grid">
        <div class="hours">
          @for (h of hours; track h) {
            <div class="hour-cell">{{ formatHour(h) }}</div>
          }
        </div>
        <div class="day-col">
          @for (h of hours; track h) { <div class="hour-line"></div> }
          @for (e of timed(); track e.id) {
            <div class="event"
                 [style.--cal-color]="colorFor()(e)"
                 [style.top.%]="topPct(e)"
                 [style.height.%]="heightPct(e)">
              <div class="evt-time">{{ e.starts_at | date:'h:mm a' }}</div>
              <div class="evt-title">{{ e.title }}</div>
            </div>
          }
          @if (nowInRange()) {
            <div class="now-line" [style.top.%]="nowPct()">
              <span class="now-dot"></span>
              <span class="now-label">{{ now() | date:'h:mm a' }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; }
    .view { display:flex; flex-direction:column; height:100%; min-height:0; gap:var(--s-2); }
    .view-head { padding-bottom:var(--s-1); border-bottom:1px solid var(--line-subtle); flex:0 0 auto; }
    .day-line { display:flex; align-items:baseline; gap:var(--s-3); flex-wrap:wrap; }
    .big-day { font-family:var(--font-display); font-size:1.75rem; line-height:1; }
    .big-date { color:var(--text-secondary); font-size:1.1rem; }

    .all-day-strip { display:flex; align-items:center; gap:var(--s-2); padding:var(--s-1) 0; border-bottom:1px solid var(--line-subtle); flex:0 0 auto; min-height:0; }
    .strip-label { font-size:0.7rem; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.05em; width:3.5rem; flex:none; }
    .strip-events { flex:1; min-width:0; display:flex; flex-wrap:wrap; gap:0.3rem; }
    .all-day-chip { background:var(--bg-raised); border-left:3px solid var(--cal-color, var(--accent)); padding:0.15rem 0.4rem; border-radius:var(--r-sm); font-size:0.85rem; font-weight:500; }

    .time-grid { flex:1; min-height:0; display:grid; grid-template-columns:3.5rem 1fr; gap:var(--s-2); overflow:hidden; }
    .hours, .day-col { display:flex; flex-direction:column; min-height:0; }
    .day-col { position:relative; background:var(--bg-surface); border-radius:var(--r-sm); border:1px solid var(--line-subtle); overflow:hidden; }
    .hour-cell { flex:1; min-height:0; font-size:0.7rem; color:var(--text-tertiary); padding-top:2px; border-top:1px dashed transparent; }
    .hour-cell:first-child { padding-top:0; }
    .hour-line { flex:1; min-height:0; border-top:1px dashed var(--line-subtle); }
    .hour-line:first-child { border-top:none; }

    .event {
      position:absolute;
      left:0.3rem; right:0.3rem;
      container-type:size;
      background:var(--bg-raised);
      border-left:4px solid var(--cal-color, var(--accent));
      border-radius:var(--r-sm);
      padding:0.2rem 0.4rem;
      overflow:hidden;
      display:flex; flex-direction:column; gap:1px;
      box-shadow:var(--shadow-sm);
    }
    .evt-time { color:var(--text-tertiary); font-variant-numeric:tabular-nums; font-size:clamp(0.6rem, 18cqh, 0.85rem); white-space:nowrap; }
    .evt-title { font-weight:600; font-size:clamp(0.75rem, 30cqh, 1.15rem); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.1; }

    .now-line {
      position:absolute; left:0; right:0;
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
    .now-label {
      position:absolute; right:0.3rem; top:-1rem;
      background:var(--danger); color:#fff;
      font-size:0.7rem; padding:1px 6px; border-radius:var(--r-sm);
      font-weight:600;
    }
  `],
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
