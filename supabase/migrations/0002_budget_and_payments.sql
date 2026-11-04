-- Budget breakdown and a real payment log, ported over from an earlier debt
-- tracker (my-debt-tracker) when the two projects were merged. Normalised like
-- debts/card_buckets rather than kept as JSONB, consistent with the rest of
-- this schema.

create table if not exists public.budget_items (
  id        text primary key,
  user_id   uuid not null references auth.users on delete cascade,
  position  integer not null default 0,

  name       text not null,
  amount     numeric(12, 2) not null default 0,
  type       text not null check (type in ('income', 'fixed', 'variable')),
  frequency  text not null default 'monthly' check (frequency in ('monthly', 'biweekly')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists budget_items_user_idx on public.budget_items (user_id, position);

-- A real payment made, distinct from the forward-looking simulator and from
-- imported statement balances. Append-mostly: kept even if its debt is deleted
-- so lifetime milestones don't silently shrink.
create table if not exists public.payments (
  id       text primary key,
  user_id  uuid not null references auth.users on delete cascade,
  debt_id  text references public.debts on delete set null,

  amount  numeric(12, 2) not null check (amount > 0),
  date    date not null,
  note    text,

  created_at  timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, date desc);

alter table public.budget_items enable row level security;
alter table public.payments     enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['budget_items', 'payments'] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I
         for all
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- Extend save_state() to also replace the caller's budget items and upsert
-- (append-only, like statements) their payment log.
create or replace function public.save_state(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- settings
  insert into public.settings (user_id, monthly_budget, start_date, strategy, updated_at)
  values (
    uid,
    coalesce((payload -> 'settings' ->> 'monthlyBudget')::numeric, 1000),
    coalesce((payload -> 'settings' ->> 'startDate')::date, current_date),
    coalesce(payload -> 'settings' ->> 'strategy', 'avalanche'),
    now()
  )
  on conflict (user_id) do update set
    monthly_budget = excluded.monthly_budget,
    start_date     = excluded.start_date,
    strategy       = excluded.strategy,
    updated_at     = now();

  -- debts removed on the client
  delete from public.debts d
  where d.user_id = uid
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(payload -> 'debts', '[]'::jsonb)) x
      where x ->> 'id' = d.id
    );

  insert into public.debts (
    id, user_id, kind, name, position, notes,
    issuer, credit_limit, statement_day, due_day,
    min_payment_pct, min_payment_floor, min_includes_interest, paid_in_full_last_statement,
    lender, balance, apr, payment_frequency, payment_amount, next_payment_date, informal,
    updated_at
  )
  select
    d ->> 'id',
    uid,
    d ->> 'kind',
    d ->> 'name',
    ord - 1,
    d ->> 'notes',
    d ->> 'issuer',
    (d ->> 'creditLimit')::numeric,
    (d ->> 'statementDay')::smallint,
    (d ->> 'dueDay')::smallint,
    (d ->> 'minPaymentPct')::numeric,
    (d ->> 'minPaymentFloor')::numeric,
    (d ->> 'minIncludesInterest')::boolean,
    (d ->> 'paidInFullLastStatement')::boolean,
    d ->> 'lender',
    (d ->> 'balance')::numeric,
    (d ->> 'apr')::numeric,
    d ->> 'paymentFrequency',
    (d ->> 'paymentAmount')::numeric,
    (d ->> 'nextPaymentDate')::date,
    (d ->> 'informal')::boolean,
    now()
  from jsonb_array_elements(coalesce(payload -> 'debts', '[]'::jsonb)) with ordinality as t(d, ord)
  on conflict (id) do update set
    kind                        = excluded.kind,
    name                        = excluded.name,
    position                    = excluded.position,
    notes                       = excluded.notes,
    issuer                      = excluded.issuer,
    credit_limit                = excluded.credit_limit,
    statement_day               = excluded.statement_day,
    due_day                     = excluded.due_day,
    min_payment_pct             = excluded.min_payment_pct,
    min_payment_floor           = excluded.min_payment_floor,
    min_includes_interest       = excluded.min_includes_interest,
    paid_in_full_last_statement = excluded.paid_in_full_last_statement,
    lender                      = excluded.lender,
    balance                     = excluded.balance,
    apr                         = excluded.apr,
    payment_frequency           = excluded.payment_frequency,
    payment_amount              = excluded.payment_amount,
    next_payment_date           = excluded.next_payment_date,
    informal                    = excluded.informal,
    updated_at                  = now();

  -- buckets removed on the client
  delete from public.card_buckets b
  where b.user_id = uid
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(payload -> 'debts', '[]'::jsonb)) d,
           jsonb_array_elements(coalesce(d -> 'buckets', '[]'::jsonb)) bk
      where bk ->> 'id' = b.id
    );

  insert into public.card_buckets (
    id, debt_id, user_id, position, label, kind, balance, apr,
    promo_apr, promo_end_date, deferred_interest,
    flex_monthly_payment, flex_monthly_fee_pct, flex_original_amount, flex_remaining_months,
    updated_at
  )
  select
    bk ->> 'id',
    d ->> 'id',
    uid,
    ord - 1,
    bk ->> 'label',
    bk ->> 'kind',
    coalesce((bk ->> 'balance')::numeric, 0),
    coalesce((bk ->> 'apr')::numeric, 0),
    (bk ->> 'promoApr')::numeric,
    nullif(bk ->> 'promoEndDate', '')::date,
    coalesce((bk ->> 'deferredInterest')::boolean, false),
    (bk ->> 'flexMonthlyPayment')::numeric,
    (bk ->> 'flexMonthlyFeePct')::numeric,
    (bk ->> 'flexOriginalAmount')::numeric,
    (bk ->> 'flexRemainingMonths')::integer,
    now()
  from jsonb_array_elements(coalesce(payload -> 'debts', '[]'::jsonb)) d,
       jsonb_array_elements(coalesce(d -> 'buckets', '[]'::jsonb)) with ordinality as t(bk, ord)
  on conflict (id) do update set
    debt_id               = excluded.debt_id,
    position              = excluded.position,
    label                 = excluded.label,
    kind                  = excluded.kind,
    balance               = excluded.balance,
    apr                   = excluded.apr,
    promo_apr             = excluded.promo_apr,
    promo_end_date        = excluded.promo_end_date,
    deferred_interest     = excluded.deferred_interest,
    flex_monthly_payment  = excluded.flex_monthly_payment,
    flex_monthly_fee_pct  = excluded.flex_monthly_fee_pct,
    flex_original_amount  = excluded.flex_original_amount,
    flex_remaining_months = excluded.flex_remaining_months,
    updated_at            = now();

  -- statements are append-only history, so they are upserted but never deleted
  insert into public.statements (id, user_id, debt_id, close_date, source, data, imported_at)
  select
    s ->> 'id',
    uid,
    s ->> 'debtId',
    (s ->> 'closeDate')::date,
    coalesce(s ->> 'source', 'manual'),
    s,
    coalesce((s ->> 'importedAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'statements', '[]'::jsonb)) s
  on conflict (id) do update set
    debt_id    = excluded.debt_id,
    close_date = excluded.close_date,
    source     = excluded.source,
    data       = excluded.data;

  -- budget items removed on the client
  delete from public.budget_items bi
  where bi.user_id = uid
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(payload -> 'budgetItems', '[]'::jsonb)) x
      where x ->> 'id' = bi.id
    );

  insert into public.budget_items (id, user_id, position, name, amount, type, frequency, updated_at)
  select
    b ->> 'id',
    uid,
    ord - 1,
    b ->> 'name',
    coalesce((b ->> 'amount')::numeric, 0),
    b ->> 'type',
    coalesce(b ->> 'frequency', 'monthly'),
    now()
  from jsonb_array_elements(coalesce(payload -> 'budgetItems', '[]'::jsonb)) with ordinality as t(b, ord)
  on conflict (id) do update set
    position   = excluded.position,
    name       = excluded.name,
    amount     = excluded.amount,
    type       = excluded.type,
    frequency  = excluded.frequency,
    updated_at = now();

  -- payments are append-only history, like statements
  insert into public.payments (id, user_id, debt_id, amount, date, note)
  select
    p ->> 'id',
    uid,
    p ->> 'debtId',
    coalesce((p ->> 'amount')::numeric, 0),
    (p ->> 'date')::date,
    p ->> 'note'
  from jsonb_array_elements(coalesce(payload -> 'payments', '[]'::jsonb)) p
  on conflict (id) do update set
    debt_id = excluded.debt_id,
    amount  = excluded.amount,
    date    = excluded.date,
    note    = excluded.note;
end $$;

revoke all on function public.save_state(jsonb) from public;
grant execute on function public.save_state(jsonb) to authenticated;
