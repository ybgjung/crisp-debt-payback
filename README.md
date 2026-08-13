# Debt tracker

A debt payoff planner that runs in your browser and optionally syncs to your own Supabase project.

```bash
npm install
npm run dev
```

Without Supabase credentials it runs local-only, storing everything in `localStorage`. Add credentials and it syncs.

## Connecting Supabase

**1. Apply the schema.** Open your project's SQL editor and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Or, with the CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF && supabase db push
```

**2. Add your credentials.**

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → Data API / API Keys**, then restart `npm run dev`. The anon key is designed to be public — every table is protected by row-level security. Never put the `service_role` key in this file. `.env.local` is git-ignored.

**3. Enable magic links.** In **Authentication → Providers → Email**, make sure email sign-in is on. Add your dev URL (`http://localhost:5173`) under **Authentication → URL Configuration → Redirect URLs**.

Then sign in from the banner in the app. Your rows are scoped to your user id.

### How data is stored

| Table | Holds |
|---|---|
| `settings` | One row per user: budget, plan start date, chosen strategy |
| `debts` | Cards and loans, with the columns each kind needs (enforced by check constraints) |
| `card_buckets` | One row per distinct rate on a card — purchases, 0% transfer, flex plan |
| `statements` | Imported statement history, kept as JSONB since issuer files vary |

Writes go through a `save_state(payload jsonb)` function that replaces your state in a single transaction — a partial write would leave balances and buckets disagreeing. It runs `security invoker`, so row-level security stays in force and it can only touch your own rows.

### Sync behaviour

Supabase is the source of truth; `localStorage` is a cache so the app renders instantly and keeps working offline. Edits save locally at once and push after a short debounce. If you're offline or a write fails, the change is queued and retried when the connection returns, with the status shown in the footer. Signing in on a device that already has local data stashes a copy under `debt-tracker-local-before-cloud` before adopting the cloud copy, so nothing is lost.

## What it does

**Tracks debt the way it's actually billed.** A credit card is not one balance — it's several, each at its own rate:

- Regular purchase balances at the standard APR
- Balance transfers on a promo rate with a hard deadline
- Flex / instalment plans (Amex Plan It, Citi Flex Pay) that charge a fixed monthly fee on the *original* amount rather than an APR — the app converts that to an effective APR so it's comparable
- Deferred-interest promos, where the whole waived amount gets back-charged if you miss the deadline

Loans track APR, payment frequency (including biweekly, which is 26 payments a year — the equivalent of 13 monthly payments), and next payment date. Informal loans to friends can be marked 0%.

**The interest math is a day-by-day simulation**, not a monthly approximation. It models statement close dates, due dates, grace periods, promo expiry on the exact day, and the CARD Act allocation rule: the minimum payment goes to your *lowest*-rate balance, and anything above the minimum must go to the *highest*-rate one. That last rule is why extra payments often can't reach a 0% transfer while a high-APR balance is open — the app flags this where it applies.

**Four payoff strategies**, compared side by side on identical budgets:

| Strategy | Order | Best for |
|---|---|---|
| Avalanche | Highest APR first | Lowest total interest — always |
| Snowball | Smallest balance first | Motivation; closing accounts sooner |
| Cash flow index | Lowest balance ÷ minimum payment | Freeing up monthly cash fastest |
| Deadline-aware | Avalanche, but jumps to promo balances near expiry | Avoiding rate jumps and deferred-interest traps |

**Statement import.** Drop in a CSV transaction export or a PDF statement. The parser detects sign conventions, separates interest and fees from purchases, extracts APRs and the new balance, and shows a review screen. Nothing changes until you confirm the number — and you can edit it before applying.

## Notes

- Local-only mode keeps data in `localStorage`. Use **Export backup** before clearing site data.
- Whole-card balance updates are applied to the highest *effective*-rate balance, so a single imported number never silently rewrites a promo balance.
- PDF parsing depends on issuer layout. Totals are usually found; individual transactions are best-effort. Check the numbers before applying.
