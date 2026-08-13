import { useRef, useState } from 'react';
import type { AppState, Debt, StatementRecord } from './types';
import { emptyState, sampleState } from './lib/storage';
import { useSync } from './lib/sync';
import Dashboard from './components/Dashboard';
import DebtList from './components/DebtList';
import PlanView from './components/PlanView';
import ImportView from './components/ImportView';
import CloudBar, { CloudStatus } from './components/CloudBar';

type Tab = 'dashboard' | 'debts' | 'plan' | 'import';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'debts', label: 'Debts' },
  { id: 'plan', label: 'Payoff plan' },
  { id: 'import', label: 'Import' },
];

export default function App() {
  const sync = useSync();
  const state = sync.state;
  const [tab, setTab] = useState<Tab>('dashboard');
  const fileRef = useRef<HTMLInputElement>(null);

  const setDebts = (debts: Debt[]) => sync.update((s) => ({ ...s, debts }));
  const setSettings = (patch: Partial<AppState['settings']>) =>
    sync.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const applyImport = (debts: Debt[], statement: StatementRecord) =>
    sync.update((s) => ({ ...s, debts, statements: [...s.statements, statement] }));

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debt-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      if (!Array.isArray(parsed.debts)) throw new Error();
      sync.replace({ ...emptyState(), ...parsed });
    } catch {
      alert('That file is not a valid backup.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            Debt tracker
            <span>{sync.email ?? 'everything stays on this device'}</span>
          </div>
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <CloudBar sync={sync} />

      {tab === 'dashboard' && <Dashboard state={state} />}
      {tab === 'debts' && <DebtList debts={state.debts} onChange={setDebts} />}
      {tab === 'plan' && <PlanView state={state} onSettings={setSettings} />}
      {tab === 'import' && <ImportView state={state} onApply={applyImport} />}

      <div className="hr" />
      <div className="split" style={{ justifyContent: 'space-between' }}>
        <span className="split muted tiny">
          <CloudStatus sync={sync} />
          {sync.cloudEnabled && sync.email
            ? `Signed in as ${sync.email}`
            : 'Saved in this browser only. Export a backup before clearing site data.'}
        </span>
        <div className="split">
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
          {!state.debts.length && (
            <button className="btn btn-sm" onClick={() => sync.replace(sampleState())}>
              Load sample data
            </button>
          )}
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Restore backup
          </button>
          <button className="btn btn-sm" onClick={exportJson}>
            Export backup
          </button>
          {sync.email && (
            <button className="btn btn-sm" onClick={() => void sync.signOut()}>
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
