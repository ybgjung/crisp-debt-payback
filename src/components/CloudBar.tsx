import { useState } from 'react';
import type { Sync } from '../lib/sync';
import { Pill } from './ui';

const STATUS: Record<
  string,
  { tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad'; label: string }
> = {
  'local-only': { tone: 'neutral', label: 'local only' },
  'signed-out': { tone: 'warn', label: 'not signed in' },
  loading: { tone: 'accent', label: 'loading…' },
  saving: { tone: 'accent', label: 'saving…' },
  saved: { tone: 'good', label: 'synced' },
  pending: { tone: 'warn', label: 'unsaved changes' },
  error: { tone: 'bad', label: 'sync failed' },
};

export function CloudStatus({ sync }: { sync: Sync }) {
  const s = STATUS[sync.status] ?? STATUS['local-only'];
  const tone = !sync.online && sync.cloudEnabled ? 'warn' : s.tone;
  const label = !sync.online && sync.cloudEnabled ? 'offline' : s.label;
  return <Pill tone={tone}>{label}</Pill>;
}

export default function CloudBar({ sync }: { sync: Sync }) {
  const [address, setAddress] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!sync.cloudEnabled) {
    return (
      <div className="notice notice-info">
        <div>
          <strong>Running local-only.</strong> Add <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to a <code>.env.local</code> file and restart{' '}
          <code>npm run dev</code> to sync this to Supabase. Your data keeps working either way.
        </div>
      </div>
    );
  }

  if (sync.status === 'signed-out') {
    async function send(e: React.FormEvent) {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        await sync.sendMagicLink(address.trim());
        setSent(true);
      } catch (e2) {
        setErr(e2 instanceof Error ? e2.message : 'Could not send the link.');
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4 }}>Sign in to sync</h2>
        <p className="muted tiny" style={{ margin: '0 0 12px' }}>
          Your debts are stored on this device right now. Sign in and they sync to your Supabase
          project, scoped to your account by row-level security.
        </p>

        {sent ? (
          <div className="notice notice-good" style={{ marginBottom: 0 }}>
            <div>
              Check <strong>{address}</strong> for a sign-in link. Open it in this browser — it
              brings you straight back here.
            </div>
          </div>
        ) : (
          <form className="split" onSubmit={send}>
            <input
              type="email"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com"
              style={{
                flex: '1 1 240px',
                background: 'var(--surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 7,
                padding: '7px 9px',
              }}
            />
            <button className="btn btn-primary" disabled={busy || !address.trim()}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        )}

        {err && (
          <div className="notice notice-bad" style={{ marginTop: 12, marginBottom: 0 }}>
            <div>{err}</div>
          </div>
        )}
      </div>
    );
  }

  if (sync.status === 'error' || (sync.error && sync.status === 'pending')) {
    return (
      <div className="notice notice-bad">
        <div style={{ flex: 1 }}>
          <strong>Couldn&apos;t sync to Supabase.</strong> {sync.error} Your changes are saved on
          this device and will be retried.
        </div>
        <button className="btn btn-sm" onClick={sync.retry}>
          Retry now
        </button>
      </div>
    );
  }

  if (!sync.online) {
    return (
      <div className="notice notice-warn">
        <div>
          <strong>Offline.</strong> Edits are saved on this device and will sync automatically when
          the connection comes back.
        </div>
      </div>
    );
  }

  return null;
}
