import { useState } from 'react';
import type { Bucket, BucketKind, CreditCard, Debt, Loan } from '../types';
import { cardInsight, flexEquivalentApr } from '../lib/engine';
import { addMonths, formatDate, parseISO, toISO, todayISO } from '../lib/dates';
import { duration, ordinal, parseNumber, pct, uid, usd, usdAuto } from '../lib/format';
import { debtBalanceOf } from '../lib/debt';
import { newCard, newLoan } from '../lib/storage';
import { Chevron, Field, Pill, Select } from './ui';

const BUCKET_LABELS: Record<BucketKind, string> = {
  purchase: 'Regular balance',
  balance_transfer: 'Balance transfer',
  flex_plan: 'Flex / instalment plan',
  cash_advance: 'Cash advance',
};

const num = parseNumber;

/** Money in, money out: two decimals, never 1200.0000000002. */
const money = (v: string) => Math.round(parseNumber(v) * 100) / 100;

// A promo rate with no end date never expires, which would quietly model a
// transfer as 0% forever. New promos get the usual 12-month term to start from.
const defaultPromoEnd = () => toISO(addMonths(parseISO(todayISO()), 12));

export default function DebtList({
  debts,
  onChange,
}: {
  debts: Debt[];
  onChange: (debts: Debt[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const update = (id: string, patch: Partial<CreditCard> | Partial<Loan>) =>
    onChange(debts.map((d) => (d.id === id ? ({ ...d, ...patch } as Debt) : d)));

  const remove = (id: string) => onChange(debts.filter((d) => d.id !== id));

  const add = (d: Debt) => {
    onChange([...debts, d]);
    setOpen(d.id);
  };

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Your debts</h2>
          <p>
            {debts.length} account{debts.length === 1 ? '' : 's'} ·{' '}
            {usdAuto(debts.reduce((s, d) => s + debtBalanceOf(d), 0))} owed
          </p>
        </div>
        <div className="split">
          <button className="btn btn-sm" onClick={() => add(newCard())}>
            + Credit card
          </button>
          <button className="btn btn-sm" onClick={() => add(newLoan(false))}>
            + Loan
          </button>
          <button className="btn btn-sm" onClick={() => add(newLoan(true))}>
            + Friend / 0%
          </button>
        </div>
      </div>

      {debts.length === 0 && (
        <div className="empty">
          <h3>No debts yet</h3>
          <p>Add a credit card or loan above, or load the sample data to look around first.</p>
        </div>
      )}

      {debts.map((d) =>
        d.kind === 'credit_card' ? (
          <CardRow
            key={d.id}
            card={d}
            open={open === d.id}
            toggle={() => setOpen(open === d.id ? null : d.id)}
            update={(p) => update(d.id, p)}
            remove={() => remove(d.id)}
          />
        ) : (
          <LoanRow
            key={d.id}
            loan={d}
            open={open === d.id}
            toggle={() => setOpen(open === d.id ? null : d.id)}
            update={(p) => update(d.id, p)}
            remove={() => remove(d.id)}
          />
        ),
      )}
    </div>
  );
}

/* ------------------------------ credit card ------------------------------ */

function CardRow({
  card,
  open,
  toggle,
  update,
  remove,
}: {
  card: CreditCard;
  open: boolean;
  toggle: () => void;
  update: (p: Partial<CreditCard>) => void;
  remove: () => void;
}) {
  const insight = cardInsight(card);
  const utilization = card.creditLimit ? insight.balance / card.creditLimit : undefined;

  const setBucket = (id: string, patch: Partial<Bucket>) =>
    update({ buckets: card.buckets.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const addBucket = (kind: BucketKind) =>
    update({
      buckets: [
        ...card.buckets,
        {
          id: uid(),
          label: BUCKET_LABELS[kind],
          kind,
          balance: 0,
          apr: kind === 'balance_transfer' ? 26.99 : card.buckets[0]?.apr ?? 24.99,
          ...(kind === 'balance_transfer'
            ? { promoApr: 0, promoEndDate: defaultPromoEnd() }
            : {}),
          ...(kind === 'flex_plan'
            ? { apr: 0, flexMonthlyPayment: 100, flexMonthlyFeePct: 0.72, flexOriginalAmount: 0 }
            : {}),
        },
      ],
    });

  return (
    <div className="debt">
      <div className="debt-head" onClick={toggle}>
        <Chevron open={open} />
        <div>
          <div className="debt-title">
            {card.name}
            {card.buckets.some((b) => b.promoApr !== undefined && b.promoEndDate) && (
              <Pill tone="accent">promo</Pill>
            )}
            {insight.neverPaysOff && <Pill tone="bad">min &lt; interest</Pill>}
          </div>
          <div className="debt-meta">
            {card.issuer ? `${card.issuer} · ` : ''}
            statement {ordinal(card.statementDay)} · due {ordinal(card.dueDay)}
            {utilization !== undefined && ` · ${Math.round(utilization * 100)}% utilization`}
          </div>
        </div>
        <div className="debt-amount">
          <div className="big">{usdAuto(insight.balance)}</div>
          <div className="small">{usd(insight.monthlyInterest, true)}/mo interest</div>
        </div>
      </div>

      {open && (
        <div className="debt-body">
          <InsightPanel insight={insight} />

          <div className="hr" />

          <div className="field-row" style={{ marginBottom: 12 }}>
            <Field label="Name" type="text" value={card.name} onChange={(v) => update({ name: v })} />
            <Field
              label="Issuer"
              type="text"
              value={card.issuer ?? ''}
              onChange={(v) => update({ issuer: v })}
            />
            <Field
              label="Credit limit"
              prefix="$"
              value={card.creditLimit ?? ''}
              onChange={(v) => update({ creditLimit: v.trim() === '' ? undefined : money(v) })}
            />
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <Field
              label="Statement closes"
              suffix="day"
              value={card.statementDay}
              min={1}
              max={31}
              onChange={(v) => update({ statementDay: Math.min(31, Math.max(1, Math.round(num(v)))) })}
            />
            <Field
              label="Payment due"
              suffix="day"
              value={card.dueDay}
              min={1}
              max={31}
              onChange={(v) => update({ dueDay: Math.min(31, Math.max(1, Math.round(num(v)))) })}
            />
            <Field
              label="Minimum"
              suffix="% of balance"
              step="0.1"
              value={card.minPaymentPct}
              onChange={(v) => update({ minPaymentPct: num(v) })}
            />
            <Field
              label="Minimum floor"
              prefix="$"
              value={card.minPaymentFloor}
              onChange={(v) => update({ minPaymentFloor: money(v) })}
            />
          </div>

          <label className="checkbox" style={{ marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={card.minIncludesInterest}
              onChange={(e) => update({ minIncludesInterest: e.target.checked })}
            />
            Minimum payment also includes the cycle&apos;s interest and fees (most issuers do this)
          </label>

          <div className="section-head">
            <h3>Balances on this card</h3>
            <div className="split">
              <button className="btn btn-sm" onClick={() => addBucket('purchase')}>
                + Regular
              </button>
              <button className="btn btn-sm" onClick={() => addBucket('balance_transfer')}>
                + Transfer
              </button>
              <button className="btn btn-sm" onClick={() => addBucket('flex_plan')}>
                + Flex plan
              </button>
            </div>
          </div>

          {card.buckets.map((b) => (
            <BucketEditor
              key={b.id}
              bucket={b}
              onChange={(p) => setBucket(b.id, p)}
              onRemove={() =>
                update({ buckets: card.buckets.filter((x) => x.id !== b.id) })
              }
              canRemove={card.buckets.length > 1}
            />
          ))}

          <div className="split" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-sm btn-danger" onClick={remove}>
              Delete card
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightPanel({ insight }: { insight: ReturnType<typeof cardInsight> }) {
  const interestShare = Math.min(1, insight.interestShareOfMin);
  const promo = insight.buckets.find(
    (b) => b.promoEndDate && (b.daysToPromoEnd ?? 0) >= 0 && b.balance > 0,
  );
  const higher = insight.buckets
    .filter((b) => b.balance > 0 && b.rate > (promo?.rate ?? 0))
    .sort((a, b) => b.rate - a.rate);
  const blocked = promo && higher.length > 0;

  return (
    <div>
      {blocked && (
        <div className="notice notice-warn">
          <div>
            <strong>Extra payments can&apos;t reach the {promo.label} balance yet.</strong> By law,
            anything you pay above the minimum must go to the highest-rate balance first — here
            that&apos;s {higher.map((h) => `${h.label} at ${pct(h.rate)}`).join(', ')}. The{' '}
            {usd(promo.balance, true)} at {pct(promo.rate)} only starts shrinking once those are
            cleared, so plan to have them gone well before {formatDate(promo.promoEndDate)}.
          </div>
        </div>
      )}
      {insight.neverPaysOff ? (
        <div className="notice notice-bad">
          <div>
            <strong>This balance grows even if you pay the minimum.</strong> The minimum of{' '}
            {usd(insight.minimumDue)} is below the {usd(insight.monthlyInterest)} of monthly
            interest, so the balance rises every cycle.
          </div>
        </div>
      ) : insight.monthsAtMinimum && insight.monthsAtMinimum > 60 ? (
        <div className="notice notice-warn">
          <div>
            <strong>Minimum payments alone take {duration(insight.monthsAtMinimum)}</strong> and cost{' '}
            {usd(insight.interestAtMinimum ?? 0)} in interest — more than{' '}
            {Math.round(((insight.interestAtMinimum ?? 0) / insight.balance) * 100)}% of what you owe.
          </div>
        </div>
      ) : null}

      <div className="stat-row" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="stat-label">Minimum due</div>
          <div className="stat-value">{usd(insight.minimumDue, true)}</div>
          <div className="stat-sub">
            {usd(insight.monthlyInterest, true)} interest +{' '}
            {usd(Math.max(0, insight.principalPerMin), true)} principal
          </div>
          <div className="bar">
            <div
              className="bar-fill"
              style={{
                width: `${interestShare * 100}%`,
                background: interestShare > 0.5 ? 'var(--bad)' : 'var(--warn)',
              }}
            />
          </div>
          <div className="stat-sub" style={{ marginTop: 4 }}>
            {Math.round(interestShare * 100)}% of the minimum is interest
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Interest per month</div>
          <div className="stat-value">{usd(insight.monthlyInterest, true)}</div>
          <div className="stat-sub">{usd(insight.monthlyInterest / 30, true)} per day</div>
        </div>
        <div className="stat">
          <div className="stat-label">Paying minimum only</div>
          <div className="stat-value">
            {insight.monthsAtMinimum ? duration(insight.monthsAtMinimum) : '—'}
          </div>
          <div className="stat-sub">
            {insight.interestAtMinimum !== undefined
              ? `${usd(insight.interestAtMinimum)} of interest`
              : 'never pays off'}
          </div>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Balance</th>
              <th className="right">Amount</th>
              <th className="right">Rate now</th>
              <th className="right">Interest / mo</th>
              <th>Promo</th>
            </tr>
          </thead>
          <tbody>
            {insight.buckets.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.label}{' '}
                  <span className="muted tiny">· {BUCKET_LABELS[b.kind].toLowerCase()}</span>
                </td>
                <td className="right">{usd(b.balance, true)}</td>
                <td className="right">{pct(b.rate)}</td>
                <td className="right">{usd(b.monthlyInterest, true)}</td>
                <td>
                  {b.promoEndDate ? (
                    b.daysToPromoEnd !== undefined && b.daysToPromoEnd < 0 ? (
                      <Pill tone="bad">expired</Pill>
                    ) : (
                      <Pill tone={(b.daysToPromoEnd ?? 999) < 120 ? 'warn' : 'good'}>
                        {formatDate(b.promoEndDate)} · {b.daysToPromoEnd}d
                      </Pill>
                    )
                  ) : (
                    <span className="muted tiny">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BucketEditor({
  bucket,
  onChange,
  onRemove,
  canRemove,
}: {
  bucket: Bucket;
  onChange: (p: Partial<Bucket>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const isFlex = bucket.kind === 'flex_plan';
  const hasPromo = bucket.promoApr !== undefined;

  return (
    <div className="bucket">
      <div className="bucket-head">
        <Pill tone={isFlex ? 'warn' : bucket.kind === 'balance_transfer' ? 'accent' : 'neutral'}>
          {BUCKET_LABELS[bucket.kind]}
        </Pill>
        {isFlex && bucket.flexMonthlyFeePct ? (
          <span className="muted tiny">
            ≈ {pct(flexEquivalentApr(bucket), 1)} effective APR at this balance
          </span>
        ) : null}
        {canRemove && (
          <button className="btn btn-sm btn-ghost btn-danger" style={{ marginLeft: 'auto' }} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <div className="field-row" style={{ marginBottom: 10 }}>
        <Field label="Label" type="text" value={bucket.label} onChange={(v) => onChange({ label: v })} />
        <Field
          label="Balance"
          prefix="$"
          step="0.01"
          value={bucket.balance}
          onChange={(v) => onChange({ balance: money(v) })}
        />
        <Field
          label={isFlex ? 'Go-to APR after plan' : 'Standard APR'}
          suffix="%"
          step="0.01"
          value={bucket.apr}
          onChange={(v) => onChange({ apr: num(v) })}
        />
      </div>

      {isFlex ? (
        <div className="field-row">
          <Field
            label="Fixed monthly payment"
            prefix="$"
            value={bucket.flexMonthlyPayment ?? 0}
            onChange={(v) => onChange({ flexMonthlyPayment: money(v) })}
          />
          <Field
            label="Monthly plan fee"
            suffix="% of original"
            step="0.01"
            value={bucket.flexMonthlyFeePct ?? 0}
            onChange={(v) => onChange({ flexMonthlyFeePct: num(v) })}
          />
          <Field
            label="Original plan amount"
            prefix="$"
            value={bucket.flexOriginalAmount ?? 0}
            onChange={(v) => onChange({ flexOriginalAmount: money(v) })}
          />
          <Field
            label="Months left"
            value={bucket.flexRemainingMonths ?? 0}
            onChange={(v) => onChange({ flexRemainingMonths: Math.max(0, Math.round(num(v))) })}
          />
        </div>
      ) : (
        <>
          <label className="checkbox" style={{ marginBottom: hasPromo ? 10 : 0 }}>
            <input
              type="checkbox"
              checked={hasPromo}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { promoApr: 0, promoEndDate: bucket.promoEndDate ?? defaultPromoEnd() }
                    : { promoApr: undefined, promoEndDate: undefined, deferredInterest: false },
                )
              }
            />
            This balance is on a promotional rate
          </label>

          {hasPromo && (
            <>
              <div className="field-row">
                <Field
                  label="Promo APR"
                  suffix="%"
                  step="0.01"
                  value={bucket.promoApr ?? 0}
                  onChange={(v) => onChange({ promoApr: num(v) })}
                />
                <Field
                  label="Promo ends"
                  type="date"
                  value={bucket.promoEndDate ?? ''}
                  onChange={(v) => onChange({ promoEndDate: v || undefined })}
                />
              </div>
              {!bucket.promoEndDate && (
                <div className="notice notice-warn" style={{ marginTop: 10 }}>
                  <div>
                    <strong>This promo has no end date,</strong> so the plan treats{' '}
                    {pct(bucket.promoApr ?? 0)} as the rate forever and will understate what this
                    balance costs. Set the date the rate jumps.
                  </div>
                </div>
              )}
              <label className="checkbox" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={!!bucket.deferredInterest}
                  onChange={(e) => onChange({ deferredInterest: e.target.checked })}
                />
                Deferred interest — unpaid balance gets all waived interest back-charged
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------- loan --------------------------------- */

function LoanRow({
  loan,
  open,
  toggle,
  update,
  remove,
}: {
  loan: Loan;
  open: boolean;
  toggle: () => void;
  update: (p: Partial<Loan>) => void;
  remove: () => void;
}) {
  const monthlyInterest = (loan.balance * (loan.informal ? 0 : loan.apr / 100)) / 12;
  const perMonth =
    loan.paymentAmount *
    ({ weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1 }[loan.paymentFrequency]);

  return (
    <div className="debt">
      <div className="debt-head" onClick={toggle}>
        <Chevron open={open} />
        <div>
          <div className="debt-title">
            {loan.name}
            {loan.informal && <Pill tone="good">no interest</Pill>}
            {loan.paymentFrequency !== 'monthly' && <Pill tone="neutral">{loan.paymentFrequency}</Pill>}
          </div>
          <div className="debt-meta">
            {loan.lender ? `${loan.lender} · ` : ''}
            {usd(loan.paymentAmount)} {loan.paymentFrequency} · next {formatDate(loan.nextPaymentDate)}
          </div>
        </div>
        <div className="debt-amount">
          <div className="big">{usdAuto(loan.balance)}</div>
          <div className="small">
            {loan.informal
              ? `${usd(perMonth, true)}/mo`
              : `${usd(monthlyInterest, true)}/mo interest`}
          </div>
        </div>
      </div>

      {open && (
        <div className="debt-body">
          {loan.informal && (
            <div className="notice notice-good">
              <div>
                No interest accrues, so every dollar reduces the balance. Payoff is purely a matter of
                payment size — the strategies below will never route extra money here ahead of an
                interest-bearing debt.
              </div>
            </div>
          )}

          <div className="field-row" style={{ marginBottom: 12 }}>
            <Field label="Name" type="text" value={loan.name} onChange={(v) => update({ name: v })} />
            <Field
              label="Lender"
              type="text"
              value={loan.lender ?? ''}
              onChange={(v) => update({ lender: v })}
            />
            <Field
              label="Balance"
              prefix="$"
              step="0.01"
              value={loan.balance}
              onChange={(v) => update({ balance: money(v) })}
            />
            <Field
              label="APR"
              suffix="%"
              step="0.01"
              value={loan.apr}
              onChange={(v) => update({ apr: num(v) })}
            />
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <Select
              label="Payment frequency"
              value={loan.paymentFrequency}
              onChange={(v) => update({ paymentFrequency: v as Loan['paymentFrequency'] })}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'biweekly', label: 'Every 2 weeks' },
                { value: 'semimonthly', label: 'Twice a month' },
                { value: 'weekly', label: 'Weekly' },
              ]}
            />
            <Field
              label="Payment amount"
              prefix="$"
              value={loan.paymentAmount}
              onChange={(v) => update({ paymentAmount: money(v) })}
            />
            <Field
              label="Next payment"
              type="date"
              value={loan.nextPaymentDate}
              onChange={(v) => update({ nextPaymentDate: v })}
            />
          </div>

          <div className="notice notice-info">
            <div>
              {usd(loan.paymentAmount)} {loan.paymentFrequency} works out to{' '}
              <strong>{usd(perMonth)} per month</strong>
              {loan.paymentFrequency === 'biweekly' &&
                ' — biweekly means 26 payments a year, so you make the equivalent of 13 monthly payments instead of 12.'}
            </div>
          </div>

          <label className="checkbox" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={!!loan.informal}
              onChange={(e) => update({ informal: e.target.checked, apr: e.target.checked ? 0 : loan.apr })}
            />
            Informal / no interest (money owed to a friend or family member)
          </label>

          <div className="split" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-sm btn-danger" onClick={remove}>
              Delete loan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
