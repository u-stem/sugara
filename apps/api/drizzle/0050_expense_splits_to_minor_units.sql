-- Convert expense_splits.amount and expense_line_items.amount from major units to minor units
-- for currencies with sub-unit decimals (decimals > 0). JPY and KRW (decimals=0) are unchanged.
-- This corrects a bug where split/line-item amounts were stored as major units (e.g. 6.25)
-- instead of minor units (e.g. 625), causing settlement totals to be ~1/100 for non-JPY currencies.

-- Currencies with 2 decimal places (multiply stored value × 100)
UPDATE expense_splits s
SET amount = s.amount * 100
FROM expenses e
WHERE s.expense_id = e.id
  AND e.currency IN ('USD','EUR','GBP','AUD','CAD','CHF','CNY','THB','SGD','HKD');

UPDATE expense_line_items li
SET amount = li.amount * 100
FROM expenses e
WHERE li.expense_id = e.id
  AND e.currency IN ('USD','EUR','GBP','AUD','CAD','CHF','CNY','THB','SGD','HKD');
