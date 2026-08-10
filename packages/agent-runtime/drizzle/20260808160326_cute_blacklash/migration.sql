-- The additive channel-management schema is installed idempotently by
-- LocalStore so an interrupted desktop migration can resume without deleting
-- the user's database or failing on a column that was already added.
SELECT 1;
