import type { AppState, Bucket, CreditCard, Debt, Loan, StatementRecord } from '../types';
import { emptyState } from './storage';
import { supabase } from './supabase';

interface DebtRow {
  id: string;
  kind: 'credit_card' | 'loan';
  name: string;
  position: number;
  notes: string | null;
  issuer: string | null;
  credit_limit: string | number | null;
  statement_day: number | null;
  due_day: number | null;
  min_payment_pct: string | number | null;
  min_payment_floor: string | number | null;
  min_includes_interest: boolean | null;
  paid_in_full_last_statement: boolean | null;
  lender: string | null;
  balance: string | number | null;
  apr: string | number | null;
  payment_frequency: Loan['paymentFrequency'] | null;
  payment_amount: string | number | null;
  next_payment_date: string | null;
  informal: boolean | null;
}

interface BucketRow {
  id: string;
  debt_id: string;
  position: number;
  label: string;
  kind: Bucket['kind'];
  balance: string | number;
  apr: string | number;
  promo_apr: string | number | null;
  promo_end_date: string | null;
  deferred_interest: boolean;
  flex_monthly_payment: string | number | null;
  flex_monthly_fee_pct: string | number | null;
  flex_original_amount: string | number | null;
  flex_remaining_months: number | null;
}

/** Postgres numerics arrive as strings to preserve precision. */
const n = (v: string | number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const req = (v: string | number | null | undefined, fallback = 0): number =>
  v === null || v === undefined ? fallback : Number(v);

function toBucket(r: BucketRow): Bucket {
  const b: Bucket = {
    id: r.id,
    label: r.label,
    kind: r.kind,
    balance: req(r.balance),
    apr: req(r.apr),
  };
  if (r.promo_apr !== null) b.promoApr = Number(r.promo_apr);
  if (r.promo_end_date) b.promoEndDate = r.promo_end_date;
  if (r.deferred_interest) b.deferredInterest = true;
  if (r.flex_monthly_payment !== null) b.flexMonthlyPayment = Number(r.flex_monthly_payment);
  if (r.flex_monthly_fee_pct !== null) b.flexMonthlyFeePct = Number(r.flex_monthly_fee_pct);
  if (r.flex_original_amount !== null) b.flexOriginalAmount = Number(r.flex_original_amount);
  if (r.flex_remaining_months !== null) b.flexRemainingMonths = r.flex_remaining_months;
  return b;
}

function toDebt(r: DebtRow, buckets: BucketRow[]): Debt {
  if (r.kind === 'loan') {
    const loan: Loan = {
      id: r.id,
      kind: 'loan',
      name: r.name,
      balance: req(r.balance),
      apr: req(r.apr),
      paymentFrequency: r.payment_frequency ?? 'monthly',
      paymentAmount: req(r.payment_amount),
      nextPaymentDate: r.next_payment_date ?? new Date().toISOString().slice(0, 10),
    };
    if (r.lender) loan.lender = r.lender;
    if (r.informal) loan.informal = true;
    if (r.notes) loan.notes = r.notes;
    return loan;
  }

  const card: CreditCard = {
    id: r.id,
    kind: 'credit_card',
    name: r.name,
    statementDay: r.statement_day ?? 1,
    dueDay: r.due_day ?? 28,
    minPaymentPct: req(r.min_payment_pct, 1),
    minPaymentFloor: req(r.min_payment_floor, 35),
    minIncludesInterest: r.min_includes_interest ?? true,
    buckets: buckets
      .filter((b) => b.debt_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map(toBucket),
  };
  if (r.issuer) card.issuer = r.issuer;
  const limit = n(r.credit_limit);
  if (limit !== undefined) card.creditLimit = limit;
  if (r.paid_in_full_last_statement) card.paidInFullLastStatement = true;
  if (r.notes) card.notes = r.notes;
  return card;
}

/**
 * Reads the signed-in user's whole state. Returns null when the account has no
 * rows yet, which the caller treats as "first run, upload what's local".
 */
export async function loadRemote(): Promise<AppState | null> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const [settingsRes, debtsRes, bucketsRes, statementsRes] = await Promise.all([
    supabase.from('settings').select('*').maybeSingle(),
    supabase.from('debts').select('*').order('position'),
    supabase.from('card_buckets').select('*').order('position'),
    supabase.from('statements').select('data').order('close_date', { ascending: false }),
  ]);

  for (const res of [settingsRes, debtsRes, bucketsRes, statementsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const debtRows = (debtsRes.data ?? []) as DebtRow[];
  const bucketRows = (bucketsRes.data ?? []) as BucketRow[];
  const settingsRow = settingsRes.data as
    | { monthly_budget: string | number; start_date: string; strategy: string }
    | null;

  if (!settingsRow && !debtRows.length) return null;

  const base = emptyState();
  return {
    debts: debtRows.map((r) => toDebt(r, bucketRows)),
    settings: settingsRow
      ? {
          monthlyBudget: Number(settingsRow.monthly_budget),
          startDate: settingsRow.start_date,
          strategy: settingsRow.strategy as AppState['settings']['strategy'],
        }
      : base.settings,
    statements: ((statementsRes.data ?? []) as { data: StatementRecord }[]).map((r) => r.data),
  };
}

/** Replaces the user's state in a single transaction on the server. */
export async function saveRemote(state: AppState): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('save_state', { payload: state });
  if (error) throw new Error(error.message);
}
