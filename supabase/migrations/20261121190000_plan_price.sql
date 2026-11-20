-- Plus costs 49 kr / $5 a month, the placeholder price every screen shows
-- (src/lib/plans.ts). 20261121140000_payments set 99 kr / $9, and it may
-- already be applied, so the price changes here. plans.ts and this table must
-- agree; test/plans-parity.test.mjs checks every plan's price and limits.

update public.plans set price_nok = 49, price_usd_cents = 500
where id = 'plus';
