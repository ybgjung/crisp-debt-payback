import type {
  Bucket,
  CreditCard,
  Debt,
  ISODate,
  Loan,
  PaymentFrequency,
  Settings,
  StrategyId,
} from '../types';
import {
  addDays,
  addMonths,
  dayOfMonthMatches,
  daysInMonth,
  monthKey,
  parseISO,
  toISO,
} from './dates';

const CENT = 0.005;
const MAX_YEARS = 60;

export interface SimEvent {
  date: ISODate;
  type: 'promo_end' | 'deferred_interest' | 'payoff' | 'shortfall' | 'flex_end';
  debtId?: string;
  message: string;
}

export interface DebtOutcome {
  debtId: string;
  name: string;
  payoffDate?: ISODate;
  interestPaid: number;
  feesPaid: number;
  principalPaid: number;
  startingBalance: number;
}

export interface TimelinePoint {
  date: ISODate;
  totalBalance: number;
  cumulativeInterest: number;
  cumulativePaid: number;
  byDebt: Record<string, number>;
}

export interface SimResult {
  strategy: StrategyId;
  months: number;
  payoffDate?: ISODate;
  totalInterest: number;
  totalFees: number;
  totalPaid: number;
  startingBalance: number;
  perDebt: DebtOutcome[];
  timeline: TimelinePoint[];
  events: SimEvent[];
  /** Budget is below the sum of contractual minimums. */
  shortfall: boolean;
  requiredMinimum: number;
  incomplete: boolean;
}

interface SimBucket {
  id: string;
  cardId: string;
  label: string;
  kind: Bucket['kind'];
  balance: number;
  accrued: number;
  apr: number;
  promoApr?: number;
  promoEnd?: Date;
  deferredInterest: boolean;
  waived: number;
  promoExpired: boolean;
  flexMonthlyPayment: number;
  flexMonthlyFeePct: number;
  flexOriginalAmount: number;
  flexRemainingMonths: number;
  closed: boolean;
}

interface SimCard {
  kind: 'credit_card';
  id: string;
  name: string;
  statementDay: number;
  dueDay: number;
  minPaymentPct: number;
  minPaymentFloor: number;
  minIncludesInterest: boolean;
  buckets: SimBucket[];
  statementBalance: number;
  minimumDue: number;
  cycleInterest: number;
  cycleFees: number;
  graceActive: boolean;
  paidThisCycle: number;
  interestPaid: number;
  feesPaid: number;
  paidTotal: number;
  startingBalance: number;
  payoffDate?: ISODate;
}

interface SimLoan {
  kind: 'loan';
  id: string;
  name: string;
  balance: number;
  accrued: number;
  apr: number;
  frequency: PaymentFrequency;
  paymentAmount: number;
  nextPayment: Date;
  interestPaid: number;
  paidTotal: number;
  startingBalance: number;
  payoffDate?: ISODate;
}

type SimDebt = SimCard | SimLoan;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface RateShape {
  apr: number;
  promoApr?: number;
  promoEnd?: Date;
  promoEndDate?: string;
}

export function effectiveApr(b: RateShape, on: Date): number {
  const end = b.promoEnd ?? (b.promoEndDate ? parseISO(b.promoEndDate) : undefined);
  const promo = b.promoApr;
  if (promo === undefined) return b.apr;
  if (!end || on.getTime() <= end.getTime()) return promo;
  return b.apr;
}

/** Flex plans charge a monthly fee on the original amount instead of an APR. */
export function flexEquivalentApr(b: Bucket | SimBucket): number {
  const feePct = b.flexMonthlyFeePct ?? 0;
  // A plan whose original amount was never filled in is charged against what is
  // left of it. Falling back to 0 instead would silently make the plan free.
  const original = b.flexOriginalAmount || b.balance;
  const bal = b.balance;
  if (!feePct || !original || bal <= 0) return b.apr;
  // Fee is fixed against the original amount, so the effective rate on the
  // remaining balance rises as the plan is paid down.
  return ((feePct / 100) * original * 12 * 100) / bal;
}

function costRate(b: SimBucket, on: Date): number {
  if (b.kind === 'flex_plan' && b.flexMonthlyFeePct > 0) {
    return flexEquivalentApr(b);
  }
  return effectiveApr(b, on);
}

function buildCard(c: CreditCard): SimCard {
  const buckets: SimBucket[] = c.buckets.map((b) => ({
    id: b.id,
    cardId: c.id,
    label: b.label,
    kind: b.kind,
    balance: b.balance,
    accrued: 0,
    apr: b.apr,
    promoApr: b.promoApr,
    promoEnd: b.promoEndDate ? parseISO(b.promoEndDate) : undefined,
    deferredInterest: !!b.deferredInterest,
    waived: 0,
    promoExpired: false,
    flexMonthlyPayment: b.flexMonthlyPayment ?? 0,
    flexMonthlyFeePct: b.flexMonthlyFeePct ?? 0,
    flexOriginalAmount: b.flexOriginalAmount || b.balance,
    flexRemainingMonths: b.flexRemainingMonths ?? 0,
    closed: b.balance <= CENT,
  }));
  const start = buckets.reduce((s, b) => s + b.balance, 0);
  return {
    kind: 'credit_card',
    id: c.id,
    name: c.name,
    statementDay: c.statementDay,
    dueDay: c.dueDay,
    minPaymentPct: c.minPaymentPct,
    minPaymentFloor: c.minPaymentFloor,
    minIncludesInterest: c.minIncludesInterest,
    buckets,
    statementBalance: start,
    minimumDue: 0,
    cycleInterest: 0,
    cycleFees: 0,
    graceActive: !!c.paidInFullLastStatement,
    paidThisCycle: 0,
    interestPaid: 0,
    feesPaid: 0,
    paidTotal: 0,
    startingBalance: start,
  };
}

function buildLoan(l: Loan): SimLoan {
  return {
    kind: 'loan',
    id: l.id,
    name: l.name,
    balance: l.balance,
    accrued: 0,
    apr: l.informal ? 0 : l.apr,
    frequency: l.paymentFrequency,
    paymentAmount: l.paymentAmount,
    nextPayment: parseISO(l.nextPaymentDate),
    interestPaid: 0,
    paidTotal: 0,
    startingBalance: l.balance,
  };
}

export function advancePayment(d: Date, f: PaymentFrequency): Date {
  switch (f) {
    case 'weekly':
      return addDays(d, 7);
    case 'biweekly':
      return addDays(d, 14);
    case 'semimonthly':
      return addDays(d, 15);
    default:
      return addMonths(d, 1);
  }
}

function paymentsPerMonth(f: PaymentFrequency): number {
  switch (f) {
    case 'weekly':
      return 52 / 12;
    case 'biweekly':
      return 26 / 12;
    case 'semimonthly':
      return 2;
    default:
      return 1;
  }
}

function debtBalance(d: SimDebt): number {
  if (d.kind === 'loan') return d.balance + d.accrued;
  return d.buckets.reduce((s, b) => s + b.balance + b.accrued, 0);
}

/** Minimum contractual payment per month, used for budget checks and CFI. */
export function monthlyMinimum(d: SimDebt, on: Date): number {
  if (d.kind === 'loan') {
    return d.balance > CENT ? d.paymentAmount * paymentsPerMonth(d.frequency) : 0;
  }
  const bal = debtBalance(d);
  if (bal <= CENT) return 0;
  const flex = d.buckets
    .filter((b) => !b.closed && b.kind === 'flex_plan')
    .reduce((s, b) => s + b.flexMonthlyPayment, 0);
  const revolving = d.buckets
    .filter((b) => !b.closed && b.kind !== 'flex_plan')
    .reduce((s, b) => s + b.balance + b.accrued, 0);
  if (revolving <= CENT) return Math.min(flex, bal);
  const interest = d.buckets
    .filter((b) => !b.closed && b.kind !== 'flex_plan')
    .reduce((s, b) => s + (b.balance * costRate(b, on)) / 100 / 12, 0);
  let min = (revolving * d.minPaymentPct) / 100;
  if (d.minIncludesInterest) min += interest;
  min = Math.max(min, d.minPaymentFloor);
  return Math.min(min + flex, bal);
}

function closeStatement(card: SimCard) {
  let interest = 0;
  for (const b of card.buckets) {
    if (b.accrued > 0) {
      interest += b.accrued;
      b.balance += b.accrued;
      b.accrued = 0;
    }
  }
  card.cycleInterest = interest;
  const bal = card.buckets.reduce((s, b) => s + b.balance, 0);
  card.statementBalance = bal;

  const flex = card.buckets
    .filter((b) => b.balance > CENT && b.kind === 'flex_plan')
    .reduce((s, b) => s + b.flexMonthlyPayment, 0);
  const revolving = card.buckets
    .filter((b) => b.balance > CENT && b.kind !== 'flex_plan')
    .reduce((s, b) => s + b.balance, 0);

  let min = 0;
  if (revolving > CENT) {
    min = (revolving * card.minPaymentPct) / 100;
    if (card.minIncludesInterest) min += interest + card.cycleFees;
    min = Math.max(min, card.minPaymentFloor);
  }
  card.minimumDue = Math.min(min + flex, bal);
  card.cycleFees = 0;
  card.paidThisCycle = 0;
}

/**
 * CARD Act allocation: the minimum payment may be applied to the lowest-APR
 * balance first (issuer's choice), but anything ABOVE the minimum must go to
 * the highest-APR balance first. Extra payments therefore cannot be aimed at a
 * 0% transfer while a high-APR balance is still open.
 */
function applyCardPayment(card: SimCard, amount: number, on: Date): number {
  let remaining = amount;
  const open = () => card.buckets.filter((b) => b.balance > CENT);

  const minPortion = Math.min(remaining, card.minimumDue);
  let excess = remaining - minPortion;
  remaining = minPortion;

  // Contractual flex installments come out of the minimum first.
  for (const b of card.buckets) {
    if (remaining <= CENT) break;
    if (b.kind !== 'flex_plan' || b.balance <= CENT) continue;
    const pay = Math.min(remaining, b.flexMonthlyPayment, b.balance);
    b.balance -= pay;
    remaining -= pay;
    if (b.flexRemainingMonths > 0) b.flexRemainingMonths -= 1;
  }

  // Remainder of the minimum: lowest cost rate first.
  const ascending = open().sort((a, b) => costRate(a, on) - costRate(b, on));
  for (const b of ascending) {
    if (remaining <= CENT) break;
    const pay = Math.min(remaining, b.balance);
    b.balance -= pay;
    remaining -= pay;
  }

  // Excess: highest cost rate first (required by law).
  const descending = open().sort((a, b) => costRate(b, on) - costRate(a, on));
  for (const b of descending) {
    if (excess <= CENT) break;
    const pay = Math.min(excess, b.balance);
    b.balance -= pay;
    excess -= pay;
  }

  return amount - remaining - excess;
}

function rankDebts(
  debts: SimDebt[],
  strategy: StrategyId,
  on: Date,
): SimDebt[] {
  const active = debts.filter((d) => debtBalance(d) > CENT);
  const score = (d: SimDebt): number => {
    switch (strategy) {
      case 'snowball':
        return debtBalance(d);
      case 'cashflow': {
        const min = monthlyMinimum(d, on);
        return min > 0 ? debtBalance(d) / min : Number.MAX_SAFE_INTEGER;
      }
      case 'deadline': {
        // Prioritise anything whose promo rate is about to expire, then rate.
        if (d.kind === 'credit_card') {
          const urgent = d.buckets
            .filter((b) => b.balance > CENT && b.promoEnd && !b.promoExpired)
            .map((b) => (b.promoEnd!.getTime() - on.getTime()) / 86400000);
          if (urgent.length) {
            const soonest = Math.min(...urgent);
            if (soonest < 365) return -10000 + soonest;
          }
        }
        return -highestRate(d, on);
      }
      default:
        return -highestRate(d, on);
    }
  };
  return active.sort((a, b) => score(a) - score(b));
}

function highestRate(d: SimDebt, on: Date): number {
  if (d.kind === 'loan') return d.apr;
  return d.buckets
    .filter((b) => b.balance > CENT)
    .reduce((m, b) => Math.max(m, costRate(b, on)), 0);
}

export function simulate(
  debts: Debt[],
  settings: Settings,
  strategy: StrategyId,
): SimResult {
  const sim: SimDebt[] = debts.map((d) =>
    d.kind === 'credit_card' ? buildCard(d) : buildLoan(d),
  );
  const startingBalance = sim.reduce((s, d) => s + debtBalance(d), 0);
  const events: SimEvent[] = [];
  const timeline: TimelinePoint[] = [];

  let day = parseISO(settings.startDate);
  for (const d of sim) {
    if (d.kind !== 'loan') continue;
    let guard = 0;
    while (d.nextPayment < day && guard++ < 1000) {
      d.nextPayment = advancePayment(d.nextPayment, d.frequency);
    }
  }
  for (const d of sim) {
    if (d.kind === 'credit_card') d.minimumDue = monthlyMinimum(d, day);
  }
  const budget = settings.monthlyBudget;
  let pool = 0;
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  let shortfall = false;
  let requiredMinimum = sim.reduce((s, d) => s + monthlyMinimum(d, day), 0);
  let currentMonth = '';
  let incomplete = true;
  let payoffDate: ISODate | undefined;

  const snapshot = () => {
    const byDebt: Record<string, number> = {};
    for (const d of sim) byDebt[d.id] = round(debtBalance(d));
    timeline.push({
      date: toISO(day),
      totalBalance: round(sim.reduce((s, d) => s + debtBalance(d), 0)),
      cumulativeInterest: round(totalInterest),
      cumulativePaid: round(totalPaid),
      byDebt,
    });
  };
  snapshot();

  const maxDays = MAX_YEARS * 366;
  for (let i = 0; i < maxDays; i++) {
    const mk = monthKey(day);
    if (mk !== currentMonth) {
      currentMonth = mk;
      // Starting mid-month only leaves part of that month's budget to work
      // with. Granting the whole thing made a plan started on the 28th finish
      // sooner than the same plan started on the 1st.
      const share =
        i === 0
          ? (daysInMonth(day.getUTCFullYear(), day.getUTCMonth()) - day.getUTCDate() + 1) /
            daysInMonth(day.getUTCFullYear(), day.getUTCMonth())
          : 1;
      pool += budget * share;
      const need = sim.reduce((s, d) => s + monthlyMinimum(d, day), 0);
      requiredMinimum = Math.max(requiredMinimum, 0);
      if (need > budget + CENT && !shortfall && need > 0) {
        shortfall = true;
        requiredMinimum = need;
        events.push({
          date: toISO(day),
          type: 'shortfall',
          message: `Budget of $${budget.toFixed(0)} is below the $${need.toFixed(
            0,
          )} of minimum payments due this month.`,
        });
      }
      if (i > 0) snapshot();
    }

    // --- accrue interest ---
    for (const d of sim) {
      if (d.kind === 'loan') {
        if (d.balance > CENT && d.apr > 0) {
          const amt = (d.balance * (d.apr / 100)) / 365;
          d.accrued += amt;
          d.interestPaid += amt;
          totalInterest += amt;
        }
      } else {
        for (const b of d.buckets) {
          if (b.balance <= CENT) {
            if (!b.closed) b.closed = true;
            continue;
          }
          if (b.promoEnd && !b.promoExpired && day > b.promoEnd) {
            b.promoExpired = true;
            if (b.deferredInterest && b.waived > CENT) {
              b.balance += b.waived;
              // Charge it to the card as well as the running total, or the
              // back-charge lands in the per-debt row as principal paid.
              d.cycleFees += b.waived;
              d.feesPaid += b.waived;
              totalFees += b.waived;
              events.push({
                date: toISO(day),
                type: 'deferred_interest',
                debtId: d.id,
                message: `${d.name} — "${b.label}" deferred interest of $${b.waived.toFixed(
                  0,
                )} was back-charged when the promo ended.`,
              });
              b.waived = 0;
            } else {
              events.push({
                date: toISO(day),
                type: 'promo_end',
                debtId: d.id,
                message: `${d.name} — "${b.label}" promo rate ended with $${b.balance.toFixed(
                  0,
                )} left; rate goes to ${b.apr}%.`,
              });
            }
          }

          if (b.kind === 'flex_plan' && b.flexMonthlyFeePct > 0) continue;

          const rate = effectiveApr(b, day);
          const grace = d.graceActive && b.kind === 'purchase';
          if (grace) continue;
          if (rate > 0) {
            b.accrued += (b.balance * (rate / 100)) / 365;
          } else if (b.deferredInterest) {
            b.waived += (b.balance * (b.apr / 100)) / 365;
          }
        }

        // Flex plan monthly fee, charged on the statement day.
        if (dayOfMonthMatches(day, d.statementDay)) {
          for (const b of d.buckets) {
            if (b.balance > CENT && b.kind === 'flex_plan' && b.flexMonthlyFeePct > 0) {
              const fee = (b.flexOriginalAmount * b.flexMonthlyFeePct) / 100;
              b.balance += fee;
              d.cycleFees += fee;
              d.feesPaid += fee;
              totalFees += fee;
            }
          }
        }
      }
    }

    // --- statement close ---
    for (const d of sim) {
      if (d.kind === 'credit_card' && dayOfMonthMatches(day, d.statementDay)) {
        closeStatement(d);
        d.interestPaid += d.cycleInterest;
        totalInterest += d.cycleInterest;
      }
    }

    // --- payments ---
    const payDebt = (d: SimDebt, amount: number): number => {
      const pay = Math.min(amount, debtBalance(d), pool);
      if (pay <= CENT) return 0;
      pool -= pay;
      totalPaid += pay;
      d.paidTotal += pay;

      if (d.kind === 'loan') {
        const toInterest = Math.min(pay, d.accrued);
        d.accrued -= toInterest;
        d.balance = Math.max(0, d.balance - (pay - toInterest));
        if (d.balance <= CENT) d.balance = 0;
      } else {
        // Payments can only be applied to posted bucket balances, so any part of
        // a payment that runs past them would otherwise be counted as paid while
        // reducing nothing. Post the interest accrued since the last statement
        // closed — which is what an issuer does when a card is settled early —
        // and the whole payment lands somewhere.
        const posted = d.buckets.reduce((s, b) => s + b.balance, 0);
        if (pay >= posted - CENT) {
          for (const b of d.buckets) {
            if (b.accrued > CENT) {
              b.balance += b.accrued;
              d.interestPaid += b.accrued;
              totalInterest += b.accrued;
              b.accrued = 0;
            }
          }
        }
        d.graceActive = pay >= d.statementBalance - CENT;
        applyCardPayment(d, pay, day);
        d.paidThisCycle += pay;
        d.minimumDue = Math.max(0, d.minimumDue - pay);
      }

      if (debtBalance(d) <= CENT && !d.payoffDate) {
        d.payoffDate = toISO(day);
        events.push({
          date: toISO(day),
          type: 'payoff',
          debtId: d.id,
          message: `${d.name} paid off.`,
        });
      }
      return pay;
    };

    const reserveFor = (exclude: SimDebt) =>
      sim
        .filter((o) => o.id !== exclude.id && debtBalance(o) > CENT)
        .reduce((s, o) => s + remainingObligation(o, day), 0);

    let target = rankDebts(sim, strategy, day)[0];
    let clearedToday = false;

    for (const d of sim) {
      if (debtBalance(d) <= CENT) continue;
      const isDue =
        d.kind === 'loan'
          ? day.getTime() >= d.nextPayment.getTime()
          : dayOfMonthMatches(day, d.dueDay);
      if (!isDue) continue;

      // The schedule advances whether or not the budget covers this instalment,
      // so an underfunded month cannot freeze the loan forever.
      if (d.kind === 'loan') d.nextPayment = advancePayment(d.nextPayment, d.frequency);

      const required = d.kind === 'loan' ? d.paymentAmount : d.minimumDue;
      const amount =
        target && d.id === target.id
          ? Math.max(required, pool - reserveFor(d))
          : required;

      const before = debtBalance(d);
      payDebt(d, amount);
      if (before > CENT && debtBalance(d) <= CENT) clearedToday = true;
    }

    // Clearing a debt mid-cycle frees budget that would otherwise sit idle until
    // the next target's due date; redirect it the same day.
    let guard = 0;
    while (clearedToday && guard++ < 20) {
      target = rankDebts(sim, strategy, day)[0];
      if (!target) break;
      if (payDebt(target, pool - reserveFor(target)) <= CENT) break;
      if (debtBalance(target) > CENT) break;
    }

    if (sim.every((d) => debtBalance(d) <= CENT)) {
      payoffDate = toISO(day);
      incomplete = false;
      snapshot();
      break;
    }

    day = addDays(day, 1);
  }

  const start = parseISO(settings.startDate);
  const months = payoffDate
    ? Math.max(
        1,
        Math.round((parseISO(payoffDate).getTime() - start.getTime()) / 86400000 / 30.44),
      )
    : MAX_YEARS * 12;

  const perDebt: DebtOutcome[] = sim.map((d) => ({
    debtId: d.id,
    name: d.name,
    payoffDate: d.payoffDate,
    interestPaid: round(d.interestPaid),
    feesPaid: round(d.kind === 'credit_card' ? d.feesPaid : 0),
    principalPaid: round(
      d.paidTotal - d.interestPaid - (d.kind === 'credit_card' ? d.feesPaid : 0),
    ),
    startingBalance: round(d.startingBalance),
  }));

  return {
    strategy,
    months,
    payoffDate,
    totalInterest: round(totalInterest),
    totalFees: round(totalFees),
    totalPaid: round(totalPaid),
    startingBalance: round(startingBalance),
    perDebt,
    timeline,
    events,
    shortfall,
    requiredMinimum: round(requiredMinimum),
    incomplete,
  };
}

/** What this debt still needs from the budget before the month ends. */
function remainingObligation(d: SimDebt, on: Date): number {
  const bal = debtBalance(d);
  if (bal <= CENT) return 0;
  if (d.kind === 'loan') {
    let count = 0;
    let next = d.nextPayment;
    while (next.getUTCMonth() === on.getUTCMonth() && next >= on) {
      count++;
      next = advancePayment(next, d.frequency);
      if (count > 6) break;
    }
    return Math.min(d.paymentAmount * count, bal);
  }
  const dim = new Date(
    Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dueThisMonth = Math.min(d.dueDay, dim);
  if (dueThisMonth < on.getUTCDate()) return 0;
  if (dueThisMonth === on.getUTCDate() && d.paidThisCycle > CENT) return 0;
  return Math.min(d.minimumDue > 0 ? d.minimumDue : monthlyMinimum(d, on), bal);
}

export function runAllStrategies(
  debts: Debt[],
  settings: Settings,
): Record<StrategyId, SimResult> {
  const ids: StrategyId[] = ['avalanche', 'snowball', 'cashflow', 'deadline'];
  const out = {} as Record<StrategyId, SimResult>;
  for (const id of ids) out[id] = simulate(debts, settings, id);
  return out;
}

/** Interest-only view of a card so the statement math is legible. */
export interface CardInsight {
  balance: number;
  monthlyInterest: number;
  minimumDue: number;
  interestShareOfMin: number;
  principalPerMin: number;
  monthsAtMinimum?: number;
  interestAtMinimum?: number;
  neverPaysOff: boolean;
  buckets: {
    id: string;
    label: string;
    kind: Bucket['kind'];
    balance: number;
    rate: number;
    monthlyInterest: number;
    promoEndDate?: ISODate;
    daysToPromoEnd?: number;
  }[];
}

export function cardInsight(card: CreditCard, on: Date = new Date()): CardInsight {
  const s = buildCard(card);
  const buckets = s.buckets.map((b) => {
    const rate = costRate(b, on);
    return {
      id: b.id,
      label: b.label,
      kind: b.kind,
      balance: round(b.balance),
      rate: round(rate),
      monthlyInterest: round((b.balance * (rate / 100)) / 12),
      promoEndDate: b.promoEnd ? toISO(b.promoEnd) : undefined,
      daysToPromoEnd: b.promoEnd
        ? Math.round((b.promoEnd.getTime() - on.getTime()) / 86400000)
        : undefined,
    };
  });
  const balance = buckets.reduce((t, b) => t + b.balance, 0);
  const monthlyInterest = buckets.reduce((t, b) => t + b.monthlyInterest, 0);
  const minimumDue = monthlyMinimum(s, on);
  const principalPerMin = minimumDue - monthlyInterest;

  let monthsAtMinimum: number | undefined;
  let interestAtMinimum: number | undefined;
  const neverPaysOff = principalPerMin <= 0 && balance > 0;

  if (!neverPaysOff && balance > 0) {
    const minOnly = simulateMinimumOnly(card, on);
    monthsAtMinimum = minOnly.months;
    interestAtMinimum = minOnly.interest;
  }

  return {
    balance: round(balance),
    monthlyInterest: round(monthlyInterest),
    minimumDue: round(minimumDue),
    interestShareOfMin: minimumDue > 0 ? monthlyInterest / minimumDue : 0,
    principalPerMin: round(principalPerMin),
    monthsAtMinimum,
    interestAtMinimum,
    neverPaysOff,
    buckets,
  };
}

/** Months and interest if only the shrinking minimum is ever paid. */
function simulateMinimumOnly(
  card: CreditCard,
  on: Date,
): { months: number; interest: number } {
  const s = buildCard(card);
  let day = new Date(on.getTime());
  let interest = 0;
  const maxDays = MAX_YEARS * 366;

  for (let i = 0; i < maxDays; i++) {
    for (const b of s.buckets) {
      if (b.balance <= CENT) continue;
      if (b.promoEnd && !b.promoExpired && day > b.promoEnd) {
        b.promoExpired = true;
        if (b.deferredInterest && b.waived > CENT) {
          b.balance += b.waived;
          interest += b.waived;
          b.waived = 0;
        }
      }
      if (b.kind === 'flex_plan' && b.flexMonthlyFeePct > 0) continue;
      const rate = effectiveApr(b, day);
      if (rate > 0) b.accrued += (b.balance * (rate / 100)) / 365;
      else if (b.deferredInterest) b.waived += (b.balance * (b.apr / 100)) / 365;
    }
    if (dayOfMonthMatches(day, s.statementDay)) {
      for (const b of s.buckets) {
        if (b.balance > CENT && b.kind === 'flex_plan' && b.flexMonthlyFeePct > 0) {
          const fee = (b.flexOriginalAmount * b.flexMonthlyFeePct) / 100;
          b.balance += fee;
          s.cycleFees += fee;
          interest += fee;
        }
      }
      closeStatement(s);
      interest += s.cycleInterest;
    }
    if (dayOfMonthMatches(day, s.dueDay)) {
      const bal = debtBalance(s);
      const pay = Math.min(s.minimumDue, bal);
      if (pay > CENT) applyCardPayment(s, pay, day);
    }
    if (debtBalance(s) <= CENT) {
      return {
        months: Math.max(1, Math.round((day.getTime() - on.getTime()) / 86400000 / 30.44)),
        interest: round(interest),
      };
    }
    day = addDays(day, 1);
  }
  return { months: MAX_YEARS * 12, interest: round(interest) };
}
