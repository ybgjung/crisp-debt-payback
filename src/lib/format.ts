export const usd = (n: number, cents = false) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });

/**
 * For balances people read as a column and add up themselves: cents appear only
 * when there are cents, so a $1,240.56 + $1,440.00 pair never heads a card
 * labelled $2,681.
 */
export const usdAuto = (n: number) => usd(n, Math.round(n * 100) % 100 !== 0);

export const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;

/**
 * Reads what someone actually types into a money or rate box: "$1,200.50",
 * "1200.", "24.99%", " 300 ". Anything that is not yet a number (an empty box,
 * a lone "-", a stray letter) reads as 0 rather than NaN, so a half-typed value
 * never poisons the projection.
 */
export function parseNumber(v: string): number {
  const cleaned = v.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function duration(months: number): string {
  if (months >= 720) return 'never';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return `${m} mo`;
  if (!m) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

export function uid(): string {
  // Uuids so rows stay collision-free once they live in Postgres. Ids created
  // before this change are still valid: the id columns are text.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
