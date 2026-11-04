import type { BudgetItem } from '../types';

export function monthlyEquivalent(item: BudgetItem): number {
  return item.frequency === 'biweekly' ? (item.amount * 26) / 12 : item.amount;
}

export interface BudgetTotals {
  income: number;
  fixed: number;
  variable: number;
  /** What's left after fixed and variable expenses — the ceiling for debt payments. */
  available: number;
}

export function budgetTotals(items: BudgetItem[]): BudgetTotals {
  let income = 0;
  let fixed = 0;
  let variable = 0;
  for (const item of items) {
    const monthly = monthlyEquivalent(item);
    if (item.type === 'income') income += monthly;
    else if (item.type === 'fixed') fixed += monthly;
    else variable += monthly;
  }
  return { income, fixed, variable, available: income - fixed - variable };
}

export interface Milestone {
  label: string;
  threshold: number;
  icon: string;
}

export const MILESTONES: Milestone[] = [
  { label: 'First payment', threshold: 1, icon: '🌱' },
  { label: '$5K paid off', threshold: 5000, icon: '✦' },
  { label: '$10K cleared', threshold: 10000, icon: '◆' },
  { label: '$20K down', threshold: 20000, icon: '▲' },
  { label: '$50K down', threshold: 50000, icon: '★' },
];

/** Every milestone whose threshold the lifetime total paid has reached. */
export function milestonesReached(totalPaid: number): Milestone[] {
  return MILESTONES.filter((m) => totalPaid >= m.threshold);
}

export function nextMilestone(totalPaid: number): { milestone: Milestone; remaining: number } | undefined {
  const next = MILESTONES.find((m) => totalPaid < m.threshold);
  return next ? { milestone: next, remaining: next.threshold - totalPaid } : undefined;
}
