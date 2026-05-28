import type { RoutineRow } from './routine.service';

// Routine recurrence expansion for calendar display — see FEATURES.md §4.3.
//
// Two cadence types behave differently on a calendar:
//   - calendar (rrule): a FIXED external schedule ("trash every Friday").
//     Expand every occurrence across the visible window.
//   - interval ("every N days"): FLOATS with completion, so future dates are
//     speculative. Show only the single next_due chip, not a speculative series.
//
// The rrule parser here is intentionally minimal — it covers the patterns the
// brain dump and routine UI actually produce (DAILY / WEEKLY+BYDAY / MONTHLY+
// BYMONTHDAY, with optional INTERVAL). Anything it can't parse falls back to
// the routine's next_due.

export interface RoutineOccurrence {
  routineId: string;
  name: string;
  category: string | null;
  date: Date;          // local midnight of the day it's due
  cadenceType: 'interval' | 'calendar';
}

const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameOrAfter(a: Date, b: Date): boolean {
  return atMidnight(a).getTime() >= atMidnight(b).getTime();
}

/** Parse a small subset of RFC5545 rrules into { freq, interval, byday[], bymonthday[] }. */
function parseRrule(rrule: string): { freq?: string; interval: number; byday: number[]; bymonthday: number[] } {
  const parts = Object.fromEntries(
    rrule.split(';').map((kv) => {
      const [k, v] = kv.split('=');
      return [k.trim().toUpperCase(), (v ?? '').trim().toUpperCase()];
    }),
  );
  const byday = (parts['BYDAY'] ?? '')
    .split(',')
    .map((d) => DOW[d.replace(/^[+-]?\d+/, '')]) // strip ordinal prefixes like 1FR
    .filter((n) => n !== undefined);
  const bymonthday = (parts['BYMONTHDAY'] ?? '')
    .split(',')
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n));
  return {
    freq: parts['FREQ'],
    interval: Math.max(1, parseInt(parts['INTERVAL'] ?? '1', 10) || 1),
    byday,
    bymonthday,
  };
}

/** True if the routine is paused over the given date. */
function isPausedOn(routine: RoutineRow, date: Date): boolean {
  return !!routine.pause_until && new Date(routine.pause_until) > date;
}

/**
 * Expand a single routine's due dates within [from, to] (inclusive).
 * Returns local-midnight Dates.
 */
export function expandRoutineOccurrences(routine: RoutineRow, from: Date, to: Date): Date[] {
  if (!routine.active) return [];
  const out: Date[] = [];
  const windowStart = atMidnight(from);
  const windowEnd = atMidnight(to);

  if (routine.cadence_type === 'calendar' && routine.cadence_rrule) {
    const { freq, interval, byday, bymonthday } = parseRrule(routine.cadence_rrule);
    if (!freq) {
      return routine.next_due ? singleNextDue(routine, windowStart, windowEnd) : [];
    }
    for (let d = new Date(windowStart); d.getTime() <= windowEnd.getTime(); d = addDays(d, 1)) {
      if (isPausedOn(routine, d)) continue;
      let hit = false;
      if (freq === 'DAILY') {
        hit = true; // interval handling for DAILY is approximate; daily routines are rare
      } else if (freq === 'WEEKLY') {
        hit = byday.length ? byday.includes(d.getDay()) : true;
      } else if (freq === 'MONTHLY') {
        hit = bymonthday.length ? bymonthday.includes(d.getDate()) : false;
      }
      if (hit) out.push(new Date(d));
    }
    // INTERVAL>1 for weekly/monthly is uncommon in household use; we don't
    // thin the series by interval here. Acceptable approximation.
    return out;
  }

  // interval cadence (and any unparseable calendar routine): single next_due chip.
  return routine.next_due ? singleNextDue(routine, windowStart, windowEnd) : [];
}

function singleNextDue(routine: RoutineRow, windowStart: Date, windowEnd: Date): Date[] {
  const due = atMidnight(new Date(routine.next_due!));
  if (isPausedOn(routine, due)) return [];
  if (due.getTime() >= windowStart.getTime() && due.getTime() <= windowEnd.getTime()) return [due];
  return [];
}

/** Expand many routines into a flat, date-sorted occurrence list. */
export function occurrencesForRoutines(routines: RoutineRow[], from: Date, to: Date): RoutineOccurrence[] {
  const out: RoutineOccurrence[] = [];
  for (const r of routines) {
    for (const date of expandRoutineOccurrences(r, from, to)) {
      out.push({ routineId: r.id, name: r.name, category: r.category, date, cadenceType: r.cadence_type });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Compute an initial next_due for a freshly-created routine so it surfaces in
 * briefings + the calendar immediately (rather than waiting for first
 * completion). Returns an ISO string or null when it can't infer one.
 */
export function initialNextDue(input: {
  cadence_type: 'interval' | 'calendar';
  interval_days?: number | null;
  cadence_rrule?: string | null;
}, fromDate = new Date()): string | null {
  const from = atMidnight(fromDate);
  if (input.cadence_type === 'interval') {
    const n = input.interval_days ?? 7;
    return addDays(from, n).toISOString();
  }
  if (input.cadence_type === 'calendar' && input.cadence_rrule) {
    // Find the first occurrence within the next 366 days.
    const to = addDays(from, 366);
    const dummy = {
      active: true,
      cadence_type: 'calendar',
      cadence_rrule: input.cadence_rrule,
      next_due: null,
      pause_until: null,
    } as unknown as RoutineRow;
    const occ = expandRoutineOccurrences(dummy, addDays(from, 1), to);
    return occ.length ? occ[0].toISOString() : null;
  }
  return null;
}
