import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventRow } from 'data-access';
import { addDays, sameDay, startOfMonthGrid } from '../date-utils';

function formatChipTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hr}${am ? 'a' : 'p'}` : `${hr}:${String(m).padStart(2, '0')}${am ? 'a' : 'p'}`;
}

interface Cell { date: Date; events: EventRow[]; inMonth: boolean }

@Component({
  selector: 'harsh-month-view',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view">
      <div class="view-head">
        <div class="title">{{ anchor() | date:'MMMM y' }}</div>
      </div>
      <div class="weekdays">
        @for (d of weekdayLabels; track d) { <div>{{ d }}</div> }
      </div>
      <div class="grid" [style.--rows]="rows()">
        @for (c of cells(); track c.date.getTime()) {
          <div class="cell" [class.out]="!c.inMonth" [class.today]="isToday(c.date)">
            <div class="num">{{ c.date | date:'d' }}</div>
            <ul class="dots">
              @for (e of c.events; track e.id) {
                <li class="dot" [style.--cal-color]="colorFor()(e)" [title]="e.title">
                  @if (!e.all_day) {
                    <span class="dot-time">{{ chipTime(e.starts_at) }}</span>
                  }
                  <span class="dot-title">{{ e.title }}</span>
                </li>
              }
            </ul>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; }
    .view { display:flex; flex-direction:column; height:100%; min-height:0; gap:var(--s-2); }
    .view-head { padding-bottom:var(--s-1); border-bottom:1px solid var(--line-subtle); flex:0 0 auto; }
    .title { font-family:var(--font-display); font-size:1.5rem; }
    .weekdays { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:var(--s-1); font-size:0.7rem; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.04em; padding:0 var(--s-1); flex:0 0 auto; }
    .grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); grid-template-rows:repeat(var(--rows), minmax(0, 1fr)); gap:var(--s-1); }
    .cell {
      container-type:size;
      container-name:mcell;
      background:var(--bg-surface); border-radius:var(--r-sm); border:1px solid var(--line-subtle);
      padding:0.2rem 0.35rem; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden;
    }
    .cell.out { background:transparent; border-color:transparent; }
    .cell.out .num { color:var(--text-disabled); }
    .cell.today { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
    .num { font-family:var(--font-display); color:var(--text-secondary); font-size:clamp(0.65rem, 12cqh, 0.9rem); line-height:1; flex:0 0 auto; }
    .dots { list-style:none; padding:0; margin:0.2rem 0 0; display:flex; flex-direction:column; gap:1px; flex:1; min-height:0; }
    .dot {
      flex:1 1 0; min-height:0;
      display:flex; align-items:center; gap:0.25rem; min-width:0; padding:0 0.2rem;
      background:var(--cal-color, var(--accent));
      color:#fff;
      border-radius:2px;
      font-size:clamp(0.5rem, 28cqh, 0.7rem);
      overflow:hidden;
    }
    .dot-time { font-variant-numeric:tabular-nums; opacity:0.85; font-weight:600; flex:none; }
    .dot-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; font-weight:500; }
  `],
})
export class MonthViewComponent {
  readonly events = input.required<EventRow[]>();
  readonly anchor = input.required<Date>();
  readonly colorFor = input.required<(e: EventRow) => string>();

  readonly weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly cells = computed<Cell[]>(() => {
    const a = this.anchor();
    const start = startOfMonthGrid(a);
    const month = a.getMonth();
    const all = this.events();
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      const events = all
        .filter((e) => sameDay(new Date(e.starts_at), date))
        .sort((x, y) => x.starts_at.localeCompare(y.starts_at));
      return { date, events, inMonth: date.getMonth() === month };
    });
  });

  readonly rows = computed(() => Math.ceil(this.cells().length / 7));

  isToday(d: Date): boolean { return sameDay(d, new Date()); }

  chipTime(iso: string): string { return formatChipTime(iso); }
}
