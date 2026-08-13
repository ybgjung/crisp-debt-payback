import { useMemo } from 'react';
import type { AppState } from '../types';
import { advancePayment, cardInsight, simulate } from '../lib/engine';
import { addDays, formatDate, formatMonth, parseISO, toISO, todayISO } from '../lib/dates';
import { duration, ordinal, usd, usdAuto } from '../lib/format';
import { Pill, Stat } from './ui';
import { debtBalanceOf } from '../lib/debt';

interface Upcoming {
  date: string;
  name: string;
  amount: number;
  kind: string;
}

export default function Dashboard({ state }: { state: AppState }) {
  const { debts, settings } = state;

  const totals = useMemo(() => {
    let balance = 0;
    let monthlyInterest = 0;
    let minimums = 0;
    for (const d of debts) {
      balance += debtBalanceOf(d);
      if (d.kind === 'credit_card') {
        const ins = cardInsight(d);
        monthlyInterest += ins.monthlyInterest;
        minimums += ins.minimumDue;
      } else {
        monthlyInterest += (d.balance * (d.informal ? 0 : d.apr / 100)) / 12;
        minimums +=
          d.paymentAmount *
          { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1 }[d.paymentFrequency];
      }
    }
    return { balance, monthlyInterest, minimums };
  }, [debts]);

  const result = useMemo(
    () => (debts.length ? simulate(debts, settings, settings.strategy) : null),
    [debts, settings],
  );

  const upcoming = useMemo(() => {
    const out: Upcoming[] = [];
    // UTC midnight, so a payment falling today is not filtered out by the
    // local clock already being past it.
    const today = parseISO(todayISO());
    const horizon = addDays(today, 45);
    for (const d of debts) {
      if (debtBalanceOf(d) <= 0) continue;
      if (d.kind === 'credit_card') {
        const ins = cardInsight(d);
        for (let m = 0; m < 2; m++) {
          const base = new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 1),
          );
          const dim = new Date(
            Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
          ).getUTCDate();
          const due = new Date(
            Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(d.dueDay, dim)),
          );
          if (due >= today && due <= horizon) {
            out.push({ date: toISO(due), name: d.name, amount: ins.minimumDue, kind: 'minimum due' });
          }
        }
      } else {
        let next = parseISO(d.nextPaymentDate);
        let guard = 0;
        while (next < today && guard++ < 400) {
          next = advancePayment(next, d.paymentFrequency);
        }
        guard = 0;
        while (next <= horizon && guard++ < 10) {
          out.push({
            date: toISO(next),
            name: d.name,
            amount: d.paymentAmount,
            kind: d.paymentFrequency === 'monthly' ? 'payment' : `${d.paymentFrequency} payment`,
          });
          next = advancePayment(next, d.paymentFrequency);
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  }, [debts]);

  const promos = useMemo(() => {
    const out: { name: string; label: string; end: string; days: number; balance: number }[] = [];
    const now = Date.now();
    for (const d of debts) {
      if (d.kind !== 'credit_card') continue;
      for (const b of d.buckets) {
        if (!b.promoEndDate || b.balance <= 0) continue;
        out.push({
          name: d.name,
          label: b.label,
          end: b.promoEndDate,
          days: Math.round((parseISO(b.promoEndDate).getTime() - now) / 86400000),
          balance: b.balance,
        });
      }
    }
    return out.sort((a, b) => a.days - b.days);
  }, [debts]);

  if (!debts.length) {
    return (
      <div className="empty">
        <h3>Start by adding a debt</h3>
        <p>Go to the Debts tab to add a card or loan, or load sample data to explore the app.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="section">
        <div className="stat-row">
          <Stat label="Total owed" value={usdAuto(totals.balance)} sub={`${debts.length} accounts`} />
          <Stat
            label="Interest per month"
            value={usd(totals.monthlyInterest)}
            sub={`${usd(totals.monthlyInterest / 30, true)} every day you carry this`}
            tone="bad"
          />
          <Stat
            label="Minimums due"
            value={usd(totals.minimums)}
            sub={
              settings.monthlyBudget >= totals.minimums ? (
                <>
                  {usd(settings.monthlyBudget - totals.minimums)} of your budget goes to extra
                </>
              ) : (
                <span style={{ color: 'var(--bad)' }}>
                  budget is {usd(totals.minimums - settings.monthlyBudget)} short
                </span>
              )
            }
          />
          {result && (
            <Stat
              label="Debt-free"
              value={formatMonth(result.payoffDate)}
              sub={`${duration(result.months)} · ${usd(result.totalInterest)} interest`}
              tone="good"
            />
          )}
        </div>
      </div>

      {promos.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2>Promo rate deadlines</h2>
              <p>What the balance needs to be gone by, before the rate jumps.</p>
            </div>
          </div>
          {promos.map((p, i) => {
            const perMonth = p.days > 0 ? p.balance / (p.days / 30.44) : 0;
            return (
              <div
                key={i}
                className={`notice notice-${p.days < 0 ? 'bad' : p.days < 120 ? 'warn' : 'info'}`}
              >
                <div>
                  <strong>
                    {p.name} — {p.label}
                  </strong>
                  {p.days < 0 ? (
                    <> promo expired {formatDate(p.end)}; the standard rate now applies.</>
                  ) : (
                    <>
                      : {usd(p.balance)} left, {p.days} days to {formatDate(p.end)}. Clearing it in
                      time takes <strong>{usd(perMonth)}/month</strong>.
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <div className="section">
          <div className="section-head">
            <h2>Coming up</h2>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((u, i) => (
                  <tr key={i}>
                    <td>{formatDate(u.date)}</td>
                    <td>
                      {u.name} <span className="muted tiny">· {u.kind}</span>
                    </td>
                    <td className="right">{usd(u.amount)}</td>
                  </tr>
                ))}
                {!upcoming.length && (
                  <tr>
                    <td colSpan={3} className="muted">
                      Nothing due in the next 45 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2>Where the interest goes</h2>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="right">Balance</th>
                  <th className="right">Interest / mo</th>
                  <th>Cycle</th>
                </tr>
              </thead>
              <tbody>
                {debts
                  .map((d) => {
                    const bal = debtBalanceOf(d);
                    const mi =
                      d.kind === 'credit_card'
                        ? cardInsight(d).monthlyInterest
                        : (d.balance * (d.informal ? 0 : d.apr / 100)) / 12;
                    return { d, bal, mi };
                  })
                  .sort((a, b) => b.mi - a.mi)
                  .map(({ d, bal, mi }) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td className="right">{usdAuto(bal)}</td>
                      <td className="right" style={{ color: mi > 0 ? 'var(--bad)' : 'var(--good)' }}>
                        {mi > 0 ? usd(mi, true) : '—'}
                      </td>
                      <td className="tiny muted">
                        {d.kind === 'credit_card' ? (
                          `closes ${ordinal(d.statementDay)}, due ${ordinal(d.dueDay)}`
                        ) : d.informal ? (
                          <Pill tone="good">0%</Pill>
                        ) : (
                          `${d.paymentFrequency}`
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
