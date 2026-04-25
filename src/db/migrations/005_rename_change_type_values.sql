-- SkyPulse Migration 005
-- Backfill existing route_changes rows to use the renamed change_type enum
-- values introduced by the grant-review fix:
--   'launch'     -> 'first_observed_in_dataset'
--   'resumption' -> 're_observed_after_gap'
--
-- Without this migration, every previously-computed row still carries the
-- old labels and the new tool queries (which filter on the renamed values)
-- return zero results — exactly the empty "no new routes" responses we saw
-- on JFK / MIA / DFW / ATL / ORD after deploy.
--
-- We drop and recreate the CHECK constraint rather than ALTER it because
-- VARCHAR + CHECK is a string column with a name-based constraint, so the
-- migration is just two UPDATEs sandwiched between constraint changes.

BEGIN;

-- 1. Allow both old and new values during the rewrite window.
ALTER TABLE route_changes
    DROP CONSTRAINT IF EXISTS route_changes_change_type_check;

-- 2. Backfill the renamed values.
UPDATE route_changes
   SET change_type = 'first_observed_in_dataset'
 WHERE change_type = 'launch';

UPDATE route_changes
   SET change_type = 're_observed_after_gap'
 WHERE change_type = 'resumption';

-- 3. Reinstate the CHECK constraint with the new vocabulary only.
ALTER TABLE route_changes
    ADD CONSTRAINT route_changes_change_type_check
    CHECK (change_type IN (
        'first_observed_in_dataset',
        're_observed_after_gap',
        'suspension',
        'growth',
        'reduction',
        'gauge_up',
        'gauge_down'
    ));

-- 4. Tidy up the comparison_period suffix so newly-computed rows and old
-- rows render consistently in tool responses. This is purely cosmetic but
-- avoids confusing reviewers who see two flavours of the same tag.
UPDATE route_changes
   SET comparison_period = REPLACE(comparison_period, '(launch)', '(first_observed)')
 WHERE comparison_period LIKE '%(launch)%';

COMMIT;

-- Refresh planner stats so the existing partial indexes from migration 004
-- (which were created over zero matching rows) get correct selectivity.
ANALYZE route_changes;
