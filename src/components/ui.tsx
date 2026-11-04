import { useState, type ReactNode } from 'react';

export function Field({
  label,
  value,
  onChange,
  type = 'number',
  step,
  min,
  max,
  prefix,
  suffix,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
}) {
  // Numeric fields render as text so the browser never blanks out a half-typed
  // value: `input[type=number].value` is "" for anything not yet a valid number
  // ("1200.", "-", "1e"), which used to wipe the field mid-keystroke. The draft
  // holds exactly what was typed until focus leaves, so the parsed number going
  // to the parent can round-trip without fighting the caret.
  const numeric = type === 'number';
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined || value === null ? '' : String(value));

  return (
    <div className="field">
      <label>
        {label}
        {suffix ? <span className="muted"> ({suffix})</span> : null}
      </label>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-3)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type={numeric ? 'text' : type}
          inputMode={numeric ? 'decimal' : undefined}
          value={shown}
          step={numeric ? undefined : step}
          min={numeric ? undefined : min}
          max={numeric ? undefined : max}
          onChange={(e) => {
            if (numeric) setDraft(e.target.value);
            onChange(e.target.value);
          }}
          onBlur={() => setDraft(null)}
          style={prefix ? { paddingLeft: 21 } : undefined}
        />
      </div>
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chev${open ? ' open' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
    >
      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
