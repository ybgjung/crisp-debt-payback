import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AppState, Debt, StrategyId } from '../types';
import { runAllStrategies, type SimResult } from '../lib/engine';
import { formatDate, formatMonth } from '../lib/dates';
import { duration, parseNumber, usd } from '../lib/format';
import { Field, Pill } from './ui';

const STRATEGIES: { id: StrategyId; name: string; desc: string }[] = [
  {
    id: 'avalanche',
    name: 'Avalanche',
    desc: 'Extra money goes to the highest interest rate first. Mathematically cheapest.',
  },
  {
    id: 'snowball',
    name: 'Snowball',
    desc: 'Smallest balance first. Costs more, but you close accounts sooner.',
  },
  {
    id: 'cashflow',
    name: 'Cash flow index',
    desc: 'Lowest balance-to-minimum-payment ratio first. Frees up monthly cash fastest.',
  },
  {
    id: 'deadline',
    name: 'Deadline-aware',
    desc: 'Avalanche, but jumps ahead to any promo balance whose 0% rate is about to expire.',
  },
];

const COLORS = ['#2f6df6', '#e0731a', '#0f8a5f', '#8b46d6', '#c73b3b', '#0f8fa8', '#b5a000', '#d6468b'];

export default function PlanView({
  state,
  onSettings,
}: {
  state: AppState;
  onSettings: (patch: Partial<AppState['settings']>) => void;
}) {
  const { debts, settings } = state;
  const results = useMemo(
    () => (debts.length ? runAllStrategies(debts, settings) : null),
    [debts, settings],
  );

  if (!results) {
    return (
      <div className="empty">
        <h3>Nothing to plan yet</h3>
        <p>Add a debt first and the payoff comparison will appear here.</p>
      </div>
    );
  }

  const selected = results[settings.strategy];
  const best = STRATEGIES.reduce((b, s) =>
    results[s.id].totalInterest < results[b.id].totalInterest ? s : b,
  );
  const bestInterest = results[best.id].totalInterest;

  return (
    <div>
      {selected.shortfall && (
        <div className="notice notice-bad">
          <div>
            <strong>Your budget doesn&apos;t cover the minimums.</strong> You need at least{' '}
            {usd(selected.requiredMinimum)} a month to stay current, but the budget is{' '}
            {usd(settings.monthlyBudget)}. Balances will grow and the projection below is not
            reliable until you raise the budget.
          </div>
        </div>
      )}

      <div className="section">
        <div className="card card-pad">
          <div className="field-row" style={{ maxWidth: 560 }}>
            <Field
              label="Monthly budget for all debt"
              prefix="$"
              value={settings.monthlyBudget}
              onChange={(v) => onSettings({ monthlyBudget: Math.max(0, parseNumber(v)) })}
            />
            <Field
              label="Plan starts"
              type="date"
              value={settings.startDate}
              onChange={(v) => onSettings({ startDate: v })}
            />
          </div>
          <p className="muted tiny" style={{ margin: '10px 0 0' }}>
            Every minimum payment is paid from this budget first; whatever is left over is the extra
            that the strategy directs. When a debt is cleared, its payment rolls into the next one.
          </p>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>Compare strategies</h2>
            <p>Same budget, same debts — only the order of attack changes.</p>
          </div>
        </div>

        <div className="strat-grid">
          {STRATEGIES.map((s) => {
            const r = results[s.id];
            const delta = r.totalInterest - bestInterest;
            return (
              <button
                key={s.id}
                className={`strat${settings.strategy === s.id ? ' selected' : ''}`}
                onClick={() => onSettings({ strategy: s.id })}
              >
                <div className="strat-name">
                  {s.name}
                  {s.id === best.id && <Pill tone="good">cheapest</Pill>}
                </div>
                <div className="strat-desc">{s.desc}</div>
                <div className="strat-figure">{usd(r.totalInterest)}</div>
                <div className="stat-sub">total interest · debt-free in {duration(r.months)}</div>
                <div
                  className="strat-delta"
                  style={{ color: delta > 0 ? 'var(--bad)' : 'var(--good)' }}
                >
                  {delta > 0 ? `+${usd(delta)} vs cheapest` : 'lowest interest'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section">
        <div className="stat-row">
          <div className="stat">
            <div className="stat-label">Debt-free on</div>
            <div className="stat-value">{formatMonth(selected.payoffDate)}</div>
            <div className="stat-sub">{duration(selected.months)} from now</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total interest</div>
            <div className="stat-value" style={{ color: 'var(--bad)' }}>
              {usd(selected.totalInterest)}
            </div>
            <div className="stat-sub">
              {Math.round((selected.totalInterest / selected.startingBalance) * 100)}% of what you owe
              today
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Total you&apos;ll pay</div>
            <div className="stat-value">{usd(selected.totalPaid)}</div>
            <div className="stat-sub">on {usd(selected.startingBalance)} of balances</div>
          </div>
          <div className="stat">
            <div className="stat-label">Fees</div>
            <div className="stat-value">{usd(selected.totalFees)}</div>
            <div className="stat-sub">plan fees and deferred interest</div>
          </div>
        </div>
      </div>

      <BalanceChart result={selected} debts={debts} />

      <div className="section">
        <div className="section-head">
          <div>
            <h2>Payoff order</h2>
            <p>Which account the extra money attacks, and when each one closes.</p>
          </div>
        </div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th className="right">Balance today</th>
                <th className="right">Interest paid</th>
                <th className="right">Total paid</th>
                <th>Paid off</th>
              </tr>
            </thead>
            <tbody>
              {[...selected.perDebt]
                .sort((a, b) => (a.payoffDate ?? 'z').localeCompare(b.payoffDate ?? 'z'))
                .map((d, i) => (
                  <tr key={d.debtId}>
                    <td className="muted">{i + 1}</td>
                    <td>{d.name}</td>
                    <td className="right">{usd(d.startingBalance)}</td>
                    <td className="right" style={{ color: d.interestPaid > 0 ? 'var(--bad)' : undefined }}>
                      {usd(d.interestPaid)}
                    </td>
                    <td className="right">
                      {usd(d.principalPaid + d.interestPaid + d.feesPaid)}
                    </td>
                    <td>{d.payoffDate ? formatDate(d.payoffDate) : <Pill tone="bad">not within 60 yrs</Pill>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected.events.filter((e) => e.type !== 'payoff').length > 0 && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2>Things to watch</h2>
              <p>Rate changes and traps this plan runs into.</p>
            </div>
          </div>
          {selected.events
            .filter((e) => e.type !== 'payoff')
            .slice(0, 12)
            .map((e, i) => (
              <div
                key={i}
                className={`notice notice-${e.type === 'deferred_interest' || e.type === 'shortfall' ? 'bad' : 'warn'}`}
              >
                <div>
                  <strong>{formatDate(e.date)}</strong> — {e.message}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function BalanceChart({ result, debts }: { result: SimResult; debts: Debt[] }) {
  const data = useMemo(() => {
    const points = result.timeline;
    const step = Math.max(1, Math.floor(points.length / 90));
    return points
      .filter((_, i) => i % step === 0 || i === points.length - 1)
      .map((p) => {
        const row: Record<string, number | string> = { date: p.date };
        for (const d of debts) row[d.id] = p.byDebt[d.id] ?? 0;
        return row;
      });
  }, [result, debts]);

  if (data.length < 2) return null;

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2>Balances over time</h2>
          <p>Each band is one account. The stack shrinking to zero is your payoff date.</p>
        </div>
      </div>
      <div className="card card-pad">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => formatMonth(v)}
              stroke="var(--text-3)"
              fontSize={11}
              minTickGap={40}
            />
            <YAxis
              stroke="var(--text-3)"
              fontSize={11}
              width={58}
              tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) => formatDate(String(v))}
              formatter={(value, name) => [
                usd(Number(value)),
                debts.find((d) => d.id === String(name))?.name ?? String(name),
              ]}
            />
            <Legend
              formatter={(value: string) => (
                <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
                  {debts.find((d) => d.id === value)?.name ?? value}
                </span>
              )}
            />
            {debts.map((d, i) => (
              <Area
                key={d.id}
                type="monotone"
                dataKey={d.id}
                stackId="1"
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.75}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
