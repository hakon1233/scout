-- Payments placeholders (plan/research/pricing.md). Nothing calls these yet and
-- there are no keys: the price columns are for display, and subscriptions is
-- the table a later Vipps or Stripe webhook writes (service role only). A reader
-- may read their own row.

alter table public.plans
  add column price_nok integer not null default 0 check (price_nok >= 0),
  add column price_usd_cents integer not null default 0 check (price_usd_cents >= 0),
  add column purchasable boolean not null default false;

update public.plans set price_nok = 99, price_usd_cents = 900, purchasable = true
where id = 'plus';

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('vipps', 'stripe')),
  -- Vipps agreementId or Stripe subscription id.
  provider_ref text not null unique,
  status text not null check (status in ('pending', 'active', 'past_due', 'canceled')),
  plan text not null references public.plans (id),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy subscriptions_own_read on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

revoke all on public.subscriptions from public, anon, authenticated;
grant select on public.subscriptions to authenticated;
