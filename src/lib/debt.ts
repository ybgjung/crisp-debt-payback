import type { Debt } from '../types';

export function debtBalanceOf(d: Debt): number {
  return d.kind === 'loan' ? d.balance : d.buckets.reduce((s, b) => s + b.balance, 0);
}
