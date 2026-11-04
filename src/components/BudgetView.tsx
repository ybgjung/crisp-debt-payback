import type { AppState, BudgetItem, BudgetItemType } from '../types';
import { budgetTotals, monthlyEquivalent } from '../lib/budget';
import { parseNumber, uid, usd } from '../lib/format';
import { Field, Pill, Select } from './ui';

const TYPE_LABELS: Record<BudgetItemType, string> = {
  income: 'Income',
  fixed: 'Fixed expense',
  variable: 'Variable expense',
};

export default function BudgetView({
  state,
  onChange,
  onSettings,
}: {
  state: AppState;
  onChange: (items: BudgetItem[]) => void;
  onSettings: (patch: Partial<AppState['settings']>) => void;
}) {
  const { budgetItems } = state;
  const totals = budgetTotals(budgetItems);

  const add = (type: BudgetItemType) =>
    onChange([
      ...budgetItems,
      { id: uid(), name: '', amount: 0, type, frequency: 'monthly' },
    ]);

  const update = (id: string, patch: Partial<BudgetItem>) =>
    onChange(budgetItems.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const remove = (id: string) => onChange(budgetItems.filter((b) => b.id !== id));

  const groups: { type: BudgetItemType; title: string; hint: string }[] = [
    { type: 'income', title: 'Income', hint: 'What comes in each month.' },
    { type: 'fixed', title: 'Fixed expenses', hint: "Rent, insurance — doesn't change month to month." },
    { type: 'variable', title: 'Variable expenses', hint: 'Groceries, gas — estimate an average.' },
  ];

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>Monthly budget breakdown</h2>
            <p>
              Income minus fixed and variable expenses is the honest ceiling for what you can put
              toward debt — separate from the number on the Payoff plan tab.
            </p>
          </div>
        </div>

        <div className="stat-row" style={{ marginBottom: 20 }}>
          <div className="stat">
            <div className="stat-label">Income</div>
            <div className="stat-value" style={{ color: 'var(--good)' }}>
              {usd(totals.income)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Fixed + variable</div>
            <div className="stat-value" style={{ color: 'var(--bad)' }}>
              {usd(totals.fixed + totals.variable)}
            </div>
            <div className="stat-sub">
              {usd(totals.fixed)} fixed · {usd(totals.variable)} variable
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Available for debt</div>
            <div
              className="stat-value"
              style={{ color: totals.available >= 0 ? 'var(--good)' : 'var(--bad)' }}
            >
              {usd(totals.available)}
            </div>
            <div className="stat-sub">
              {state.settings.monthlyBudget === totals.available
                ? 'matches your payoff plan budget'
                : `plan is set to ${usd(state.settings.monthlyBudget)}`}
            </div>
          </div>
        </div>

        {budgetItems.length > 0 && totals.available !== state.settings.monthlyBudget && (
          <div className="notice notice-info" style={{ marginBottom: 20 }}>
            <div>
              <strong>{usd(totals.available)}</strong> is left over after income and expenses, but
              the payoff plan is budgeting {usd(state.settings.monthlyBudget)} toward debt.
            </div>
            {totals.available > 0 && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => onSettings({ monthlyBudget: Math.round(totals.available * 100) / 100 })}
              >
                Use {usd(totals.available)} as my payoff budget
              </button>
            )}
          </div>
        )}
      </div>

      {groups.map((g) => {
        const items = budgetItems.filter((b) => b.type === g.type);
        const subtotal = items.reduce((s, b) => s + monthlyEquivalent(b), 0);
        return (
          <div className="section" key={g.type}>
            <div className="section-head">
              <div>
                <h2>{g.title}</h2>
                <p>{g.hint}</p>
              </div>
              <div className="split">
                <span className="muted tiny">{usd(subtotal)}/mo</span>
                <button className="btn btn-sm" onClick={() => add(g.type)}>
                  + Add
                </button>
              </div>
            </div>

            {items.length === 0 && (
              <div className="empty">
                <p>Nothing here yet.</p>
              </div>
            )}

            {items.map((item) => (
              <div className="bucket" key={item.id}>
                <div className="bucket-head">
                  <Pill tone={g.type === 'income' ? 'good' : g.type === 'fixed' ? 'neutral' : 'accent'}>
                    {TYPE_LABELS[item.type]}
                  </Pill>
                  <span className="muted tiny" style={{ marginLeft: 'auto' }}>
                    {usd(monthlyEquivalent(item))}/mo
                  </span>
                  <button
                    className="btn btn-sm btn-ghost btn-danger"
                    onClick={() => remove(item.id)}
                  >
                    Remove
                  </button>
                </div>
                <div className="field-row">
                  <Field
                    label="Name"
                    type="text"
                    value={item.name}
                    onChange={(v) => update(item.id, { name: v })}
                  />
                  <Field
                    label="Amount"
                    prefix="$"
                    value={item.amount}
                    onChange={(v) => update(item.id, { amount: Math.round(parseNumber(v) * 100) / 100 })}
                  />
                  <Select
                    label="Frequency"
                    value={item.frequency}
                    onChange={(v) => update(item.id, { frequency: v as BudgetItem['frequency'] })}
                    options={[
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'biweekly', label: 'Every 2 weeks' },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
