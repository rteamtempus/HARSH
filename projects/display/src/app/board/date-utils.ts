/** Calendar math used by the day/week/month views. Sunday-first week. */

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  // Always parse YYYY-MM-DD as local midnight.
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay()); // Sunday = 0
  return s;
}
export function endOfWeek(d: Date): Date {
  return endOfDay(addDays(startOfWeek(d), 6));
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
export function startOfMonthGrid(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}
export function endOfMonthGrid(d: Date): Date {
  return endOfWeek(endOfMonth(d));
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
