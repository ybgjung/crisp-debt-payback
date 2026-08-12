import type { ISODate } from '../types';

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = Math.min(d.getUTCDate(), daysInMonth(y, ((m % 12) + 12) % 12));
  return new Date(Date.UTC(y, m, day));
}

/** Clamps a day-of-month to a month that may be shorter (e.g. the 31st in February). */
export function dayOfMonthMatches(d: Date, targetDay: number): boolean {
  const dim = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  return d.getUTCDate() === Math.min(targetDay, dim);
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  );
}

export function formatDate(s: ISODate | undefined): string {
  if (!s) return '—';
  return parseISO(s).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonth(s: ISODate | undefined): string {
  if (!s) return '—';
  return parseISO(s).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayISO(): ISODate {
  return toISO(new Date());
}
