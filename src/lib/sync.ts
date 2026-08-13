import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../types';
import { loadRemote, saveRemote } from './remote';
import { loadState, saveState } from './storage';
import { isCloudConfigured, supabase } from './supabase';

export type SyncStatus =
  | 'local-only'
  | 'signed-out'
  | 'loading'
  | 'saved'
  | 'saving'
  | 'pending'
  | 'error';

const BACKUP_KEY = 'debt-tracker-local-before-cloud';
const PUSH_DELAY = 900;

export interface Sync {
  state: AppState;
  update: (updater: (prev: AppState) => AppState) => void;
  replace: (next: AppState) => void;
  status: SyncStatus;
  error: string | null;
  email: string | null;
  online: boolean;
  cloudEnabled: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

export function useSync(): Sync {
  const [state, setState] = useState<AppState>(loadState);
  const [status, setStatus] = useState<SyncStatus>(
    isCloudConfigured ? 'loading' : 'local-only',
  );
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  // JSON of the last state known to match the server. Comparing against it stops
  // a freshly-loaded remote state from being pushed straight back.
  const syncedRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signedInRef = useRef(false);

  stateRef.current = state;

  const push = useCallback(async () => {
    if (!supabase || !signedInRef.current) return;
    const snapshot = stateRef.current;
    const json = JSON.stringify(snapshot);
    if (json === syncedRef.current) return;

    if (!navigator.onLine) {
      setStatus('pending');
      return;
    }

    setStatus('saving');
    try {
      await saveRemote(snapshot);
      syncedRef.current = json;
      setError(null);
      // Another edit may have landed while the request was in flight.
      setStatus(JSON.stringify(stateRef.current) === json ? 'saved' : 'pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save to Supabase.');
      setStatus('pending');
    }
  }, []);

  const schedulePush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void push(), PUSH_DELAY);
  }, [push]);

  /* ----------------------------- local cache ----------------------------- */

  useEffect(() => {
    saveState(state);
    if (!signedInRef.current) return;
    if (JSON.stringify(state) === syncedRef.current) return;
    setStatus((s) => (s === 'saving' ? s : 'pending'));
    schedulePush();
  }, [state, schedulePush]);

  /* ------------------------------- auth ---------------------------------- */

  const adopt = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const remote = await loadRemote();
      const local = stateRef.current;

      if (!remote) {
        // Fresh account: seed it with whatever is already on this device.
        await saveRemote(local);
        syncedRef.current = JSON.stringify(local);
        setStatus('saved');
        return;
      }

      // Cloud is the source of truth, but never silently drop local work.
      if (local.debts.length && JSON.stringify(local) !== JSON.stringify(remote)) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(local));
      }
      syncedRef.current = JSON.stringify(remote);
      setState(remote);
      setStatus('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Supabase.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    const apply = (session: { user: { email?: string } } | null) => {
      if (cancelled) return;
      if (session?.user) {
        const wasSignedIn = signedInRef.current;
        signedInRef.current = true;
        setEmail(session.user.email ?? null);
        if (!wasSignedIn) void adopt();
      } else {
        signedInRef.current = false;
        syncedRef.current = null;
        setEmail(null);
        setStatus('signed-out');
      }
    };

    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session));

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [adopt]);

  /* ---------------------------- connectivity ----------------------------- */

  useEffect(() => {
    const up = () => {
      setOnline(true);
      if (signedInRef.current) void push();
    };
    const down = () => {
      setOnline(false);
      setStatus((s) => (s === 'saved' || s === 'saving' ? 'pending' : s));
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [push]);

  // Last-chance flush so a close during the debounce window is not lost.
  useEffect(() => {
    const onHide = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (signedInRef.current) void push();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [push]);

  /* ------------------------------- actions ------------------------------- */

  const sendMagicLink = useCallback(async (address: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin },
    });
    if (err) throw new Error(err.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    await push();
    await supabase.auth.signOut();
  }, [push]);

  return {
    state,
    update: (updater) => setState((prev) => updater(prev)),
    replace: (next) => setState(next),
    status,
    error,
    email,
    online,
    cloudEnabled: isCloudConfigured,
    sendMagicLink,
    signOut,
    retry: () => void push(),
  };
}
