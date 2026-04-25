-- SkyPulse Migration 004
-- Tighten the new_route_launches hot path with partial indexes that match
-- the exact predicates used by the rewritten UNION ALL query in
-- src/db/queries.ts:getRouteChanges.
--
-- Background: the reviewer measured 38-42s on Railway for ORD/MIA launch
-- queries. Migration 003 added composite indexes covering
-- (origin, change_type, comparison_period). They help, but the change_type
-- column has very low selectivity (8 enum values, with 'no_change' dominant
-- by ~90%), so the index lookup still pulls a large bitmap. A partial index
-- restricted to the two "launch-like" enum values is dramatically smaller
-- and hot in cache.
--
-- The order_by clause in the rewritten query is `ORDER BY as_of DESC`, so
-- including as_of as the trailing key enables an index-only ordered scan.

CREATE INDEX IF NOT EXISTS idx_route_changes_origin_launch_partial
  ON route_changes (origin, as_of DESC)
  WHERE change_type IN ('first_observed_in_dataset', 're_observed_after_gap');

CREATE INDEX IF NOT EXISTS idx_route_changes_destination_launch_partial
  ON route_changes (destination, as_of DESC)
  WHERE change_type IN ('first_observed_in_dataset', 're_observed_after_gap');

-- carrier_capacity_ranking groups by carrier after a market filter; an
-- index on (carrier, origin) and (carrier, destination) keeps the GROUP BY
-- cheap when the inner UNION ALL produces many rows for a hub airport.
CREATE INDEX IF NOT EXISTS idx_route_changes_origin_carrier
  ON route_changes (origin, carrier);

CREATE INDEX IF NOT EXISTS idx_route_changes_destination_carrier
  ON route_changes (destination, carrier);

-- Refresh planner stats so the new indexes are picked up immediately on
-- first query after deploy. (Migrations runner is a no-op for ANALYZE; this
-- is safe to run repeatedly.)
ANALYZE route_changes;
