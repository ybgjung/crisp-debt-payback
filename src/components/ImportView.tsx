import { useMemo, useRef, useState } from 'react';
import type { AppState, Debt } from '../types';
import {
  impliedBalance,
  parseCsv,
  parsePdf,
  toStatementRecord,
  type ParsedStatement,
} from '../lib/import';
import { effectiveApr } from '../lib/engine';
import { formatDate, todayISO } from '../lib/dates';
import { parseNumber, usd } from '../lib/format';
import { Field, Pill, Select } from './ui';
import { debtBalanceOf } from '../lib/debt';

/** The box is left blank until it is edited, in which case the suggestion stands. */
const enteredBalance = (typed: string, suggested: number) =>
  typed.trim() === '' ? suggested : Math.round(parseNumber(typed) * 100) / 100;

export default function ImportView({
  state,
  onApply,
}: {
  state: AppState;
  onApply: (debts: Debt[], statement: ReturnType<typeof toStatementRecord>) => void;
}) {
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [debtId, setDebtId] = useState(state.debts[0]?.id ?? '');
  const [bucketId, setBucketId] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [closeDate, setCloseDate] = useState(todayISO());
  const fileRef = useRef<HTMLInputElement>(null);

  const debt = state.debts.find((d) => d.id === debtId);
  const buckets = debt?.kind === 'credit_card' ? debt.buckets : [];

  const currentBalance = useMemo(() => {
    if (!debt) return 0;
    if (debt.kind === 'loan') return debt.balance;
    if (bucketId) return debt.buckets.find((b) => b.id === bucketId)?.balance ?? 0;
    return debtBalanceOf(debt);
  }, [debt, bucketId]);

  const suggested = useMemo(() => {
    if (!parsed) return 0;
    if (parsed.statementBalance !== undefined && !bucketId) return parsed.statementBalance;
    return impliedBalance(currentBalance, parsed);
  }, [parsed, currentBalance, bucketId]);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
      const result = isPdf ? await parsePdf(file) : parseCsv(await file.text(), file.name);
      setParsed(result);
      setCloseDate(result.closeDate ?? todayISO());
      setNewBalance('');
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!debt || !parsed) return;
    const value = enteredBalance(newBalance, suggested);
    if (!Number.isFinite(value) || value < 0) return;


    const updated = state.debts.map((d) => {
      if (d.id !== debt.id) return d;
      if (d.kind === 'loan') return { ...d, balance: value };
      if (bucketId) {
        return {
          ...d,
          buckets: d.buckets.map((b) => (b.id === bucketId ? { ...b, balance: value } : b)),
        };
      }
      // Whole-card update: apply the difference to the bucket with the highest
      // rate in effect today, so a single number never silently rewrites a
      // balance still sitting under a promo rate.
      const diff = value - debtBalanceOf(d);
      const now = new Date();
      const sorted = [...d.buckets].sort(
        (a, b) => effectiveApr(b, now) - effectiveApr(a, now),
      );
      const targetId = sorted[0]?.id;
      return {
        ...d,
        buckets: d.buckets.map((b) =>
          b.id === targetId
            ? { ...b, balance: Math.round(Math.max(0, b.balance + diff) * 100) / 100 }
            : b,
        ),
      };
    });

    onApply(updated, toStatementRecord(debt, bucketId || undefined, parsed, value, closeDate));
    setParsed(null);
    setNewBalance('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <div>
            <h2>Import a statement</h2>
            <p>
              Drop in a CSV transaction export or a PDF statement. Nothing is changed until you
              review the numbers and press apply.
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          {busy ? (
            <strong>Reading…</strong>
          ) : (
            <>
              <strong>Drop a CSV or PDF here</strong>
              <div className="muted tiny" style={{ marginTop: 5 }}>
                or click to choose a file · everything is parsed in your browser, nothing is uploaded
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="notice notice-bad" style={{ marginTop: 12 }}>
            <div>{error}</div>
          </div>
        )}
      </div>

      {parsed && (
        <>
          {parsed.warnings.map((w, i) => (
            <div key={i} className="notice notice-warn">
              <div>{w}</div>
            </div>
          ))}

          <div className="section">
            <div className="section-head">
              <div>
                <h2>What was found</h2>
                <p>
                  {parsed.fileName} · {parsed.source.toUpperCase()} ·{' '}
                  {parsed.transactions.length} transactions
                </p>
              </div>
            </div>

            <div className="stat-row" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="stat-label">Purchases</div>
                <div className="stat-value">{usd(parsed.purchases)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Interest charged</div>
                <div className="stat-value" style={{ color: 'var(--bad)' }}>
                  {usd(parsed.interestCharged, true)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Fees</div>
                <div className="stat-value">{usd(parsed.feesCharged, true)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Payments</div>
                <div className="stat-value" style={{ color: 'var(--good)' }}>
                  {usd(parsed.paymentsCredited)}
                </div>
              </div>
            </div>

            {parsed.aprsFound.length > 0 && (
              <div className="notice notice-info">
                <div>
                  <strong>APRs detected:</strong>{' '}
                  {parsed.aprsFound.map((a) => `${a.label} ${a.apr}%`).join(' · ')}. Check these
                  against the rates on your card in the Debts tab.
                </div>
              </div>
            )}

            <div className="card card-pad">
              <div className="field-row" style={{ marginBottom: 12 }}>
                <Select
                  label="Apply to"
                  value={debtId}
                  onChange={(v) => {
                    setDebtId(v);
                    setBucketId('');
                  }}
                  options={state.debts.map((d) => ({ value: d.id, label: d.name }))}
                />
                {buckets.length > 0 && (
                  <Select
                    label="Balance"
                    value={bucketId}
                    onChange={setBucketId}
                    options={[
                      { value: '', label: 'Whole card' },
                      ...buckets.map((b) => ({ value: b.id, label: b.label })),
                    ]}
                  />
                )}
                <Field label="Statement closed" type="date" value={closeDate} onChange={setCloseDate} />
              </div>

              <div className="hr" />

              <div className="split" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="stat-label">Balance change</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }} className="num">
                    {usd(currentBalance)} → {usd(enteredBalance(newBalance, suggested))}{' '}
                    {(() => {
                      const diff = enteredBalance(newBalance, suggested) - currentBalance;
                      return (
                        <Pill tone={diff > 0 ? 'bad' : diff < 0 ? 'good' : 'neutral'}>
                          {diff > 0 ? '+' : ''}
                          {usd(diff)}
                        </Pill>
                      );
                    })()}
                  </div>
                  <div className="muted tiny" style={{ marginTop: 4 }}>
                    {parsed.statementBalance !== undefined && !bucketId
                      ? 'Taken from the statement’s new balance line.'
                      : 'Derived from current balance + purchases + interest + fees − payments.'}
                  </div>
                </div>
                <div style={{ minWidth: 180 }}>
                  <Field
                    label="New balance (edit if wrong)"
                    prefix="$"
                    step="0.01"
                    value={newBalance === '' ? suggested : newBalance}
                    onChange={setNewBalance}
                  />
                </div>
              </div>

              <div className="split" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn" onClick={() => setParsed(null)}>
                  Discard
                </button>
                <button className="btn btn-primary" onClick={apply} disabled={!debt}>
                  Apply to {debt?.name ?? 'account'}
                </button>
              </div>
            </div>
          </div>

          {parsed.transactions.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2>Transactions</h2>
              </div>
              <div className="card table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.transactions.map((t, i) => (
                      <tr key={i}>
                        <td className="tiny">{t.date ? formatDate(t.date) : '—'}</td>
                        <td>{t.description}</td>
                        <td
                          className="right"
                          style={{ color: t.amount < 0 ? 'var(--good)' : undefined }}
                        >
                          {usd(t.amount, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {state.statements.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div>
              <h2>Import history</h2>
              <p>Every statement you have applied, so the interest trail stays visible.</p>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Account</th>
                  <th className="right">Interest</th>
                  <th className="right">Fees</th>
                  <th className="right">Payments</th>
                  <th className="right">Balance set to</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {[...state.statements]
                  .sort((a, b) => b.closeDate.localeCompare(a.closeDate))
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{formatDate(s.closeDate)}</td>
                      <td>{state.debts.find((d) => d.id === s.debtId)?.name ?? '(deleted)'}</td>
                      <td className="right" style={{ color: 'var(--bad)' }}>
                        {usd(s.interestCharged, true)}
                      </td>
                      <td className="right">{usd(s.feesCharged, true)}</td>
                      <td className="right" style={{ color: 'var(--good)' }}>
                        {usd(s.paymentsCredited)}
                      </td>
                      <td className="right">{usd(s.statementBalance)}</td>
                      <td>
                        <Pill>{s.source}</Pill>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
