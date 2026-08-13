import type { AppState, CreditCard, Loan } from '../types';
import { todayISO } from './dates';
import { uid } from './format';

const KEY = 'debt-tracker-state-v1';

export function emptyState(): AppState {
  return {
    debts: [],
    settings: { monthlyBudget: 1000, startDate: todayISO(), strategy: 'avalanche' },
    statements: [],
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as AppState;
    return {
      ...emptyState(),
      ...parsed,
      settings: { ...emptyState().settings, ...parsed.settings },
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function newCard(): CreditCard {
  return {
    id: uid(),
    kind: 'credit_card',
    name: 'New card',
    statementDay: 5,
    dueDay: 28,
    minPaymentPct: 1,
    minPaymentFloor: 35,
    minIncludesInterest: true,
    buckets: [
      {
        id: uid(),
        label: 'Purchases',
        kind: 'purchase',
        balance: 0,
        apr: 24.99,
      },
    ],
  };
}

export function newLoan(informal = false): Loan {
  return {
    id: uid(),
    kind: 'loan',
    name: informal ? 'Loan from a friend' : 'Personal loan',
    balance: 0,
    apr: informal ? 0 : 9.99,
    paymentFrequency: informal ? 'biweekly' : 'monthly',
    paymentAmount: 100,
    nextPaymentDate: todayISO(),
    informal,
  };
}

export function sampleState(): AppState {
  const state = emptyState();
  state.settings.monthlyBudget = 1800;
  state.debts = [
    {
      id: uid(),
      kind: 'credit_card',
      name: 'Chase Sapphire',
      issuer: 'Chase',
      creditLimit: 12000,
      statementDay: 6,
      dueDay: 3,
      minPaymentPct: 1,
      minPaymentFloor: 35,
      minIncludesInterest: true,
      buckets: [
        { id: uid(), label: 'Purchases', kind: 'purchase', balance: 4820, apr: 24.49 },
        {
          id: uid(),
          label: 'Balance transfer',
          kind: 'balance_transfer',
          balance: 3100,
          apr: 26.99,
          promoApr: 0,
          promoEndDate: '2027-03-01',
        },
      ],
    },
    {
      id: uid(),
      kind: 'credit_card',
      name: 'Amex Blue Cash',
      issuer: 'American Express',
      creditLimit: 9000,
      statementDay: 14,
      dueDay: 11,
      minPaymentPct: 1,
      minPaymentFloor: 40,
      minIncludesInterest: true,
      buckets: [
        { id: uid(), label: 'Purchases', kind: 'purchase', balance: 1960, apr: 27.24 },
        {
          id: uid(),
          label: 'Plan It — laptop',
          kind: 'flex_plan',
          balance: 1440,
          apr: 0,
          flexMonthlyPayment: 120,
          flexMonthlyFeePct: 0.72,
          flexOriginalAmount: 1800,
          flexRemainingMonths: 12,
        },
      ],
    },
    {
      id: uid(),
      kind: 'credit_card',
      name: 'Citi Double Cash',
      issuer: 'Citi',
      creditLimit: 6500,
      statementDay: 20,
      dueDay: 17,
      minPaymentPct: 1,
      minPaymentFloor: 30,
      minIncludesInterest: true,
      buckets: [
        { id: uid(), label: 'Purchases', kind: 'purchase', balance: 2380, apr: 22.99 },
      ],
    },
    {
      id: uid(),
      kind: 'loan',
      name: 'SoFi personal loan',
      lender: 'SoFi',
      balance: 8600,
      apr: 11.49,
      paymentFrequency: 'monthly',
      paymentAmount: 285,
      nextPaymentDate: '2026-09-01',
    },
    {
      id: uid(),
      kind: 'loan',
      name: 'Loan from Dana',
      balance: 1200,
      apr: 0,
      paymentFrequency: 'biweekly',
      paymentAmount: 75,
      nextPaymentDate: '2026-08-21',
      informal: true,
      notes: 'No interest — paying back every other Friday.',
    },
  ];
  return state;
}
