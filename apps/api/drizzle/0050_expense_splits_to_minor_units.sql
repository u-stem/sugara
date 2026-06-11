-- Convert expense_splits.amount and expense_line_items.amount from major units to minor units
-- for currencies with sub-unit decimals (decimals > 0). JPY and KRW (decimals=0) are unchanged.
-- This corrects a bug where split/line-item amounts were stored as major units (e.g. 6.25)
-- instead of minor units (e.g. 625), causing settlement totals to be ~1/100 for non-JPY currencies.

-- Only custom/itemized splits were stored as major units; equal splits have always been stored
-- in minor units via calculateEqualSplit. Applying ×100 to equal splits would corrupt data.
--
-- Cast split_type to text for the IN check to avoid the PostgreSQL restriction that prevents
-- using a newly-added enum value (added in the same transaction) in a comparison. In production
-- this migration runs after the 0025 transaction has long been committed; on a fresh db reset
-- Drizzle batches all migrations in one transaction, making the cast necessary.
UPDATE expense_splits s
SET amount = s.amount * 100
FROM expenses e
WHERE s.expense_id = e.id
  AND e.split_type::text IN ('custom', 'itemized')
  AND e.currency IN ('USD','EUR','GBP','AUD','CAD','CHF','CNY','THB','SGD','HKD');

-- expense_line_items only exist for itemized expenses, but be explicit for clarity.
UPDATE expense_line_items li
SET amount = li.amount * 100
FROM expenses e
WHERE li.expense_id = e.id
  AND e.split_type::text = 'itemized'
  AND e.currency IN ('USD','EUR','GBP','AUD','CAD','CHF','CNY','THB','SGD','HKD');

-- Recorded settlements were computed from the pre-fix (major-unit) splits and no longer
-- match the corrected transfers; clear them, mirroring the app's reset-on-expense-change rule.
DELETE FROM settlement_payments
WHERE trip_id IN (
  SELECT DISTINCT e.trip_id FROM expenses e
  WHERE e.split_type::text IN ('custom', 'itemized')
    AND e.currency IN ('USD','EUR','GBP','AUD','CAD','CHF','CNY','THB','SGD','HKD')
);
