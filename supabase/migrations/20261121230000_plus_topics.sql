-- Plus keeps its 49 kr / $5 price and holds 1 daily and 6 weekly topics
-- (was 6 daily and 3 weekly). Daily topics are the cost: one is about $1.82 a
-- month of research runs, a weekly one $0.26 (plan/research/pricing.md).
-- plans.ts and this table must agree; test/plans-parity.test.mjs checks it.
-- Readers already over the new caps keep their topics: the trigger checks a
-- cap only when a row starts to count.

update public.plans set daily_interests = 1, weekly_interests = 6
where id = 'plus';
