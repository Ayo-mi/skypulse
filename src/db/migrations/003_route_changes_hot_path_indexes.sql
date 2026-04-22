-- SkyPulse Migration 003
-- Add composite indexes that cover the tool hot-path queries flagged by the
-- Deep Validation report:
--   • new_route_launches(airport=?, change_type IN (...), period ILIKE ?)
--   • carrier_capacity_ranking(market=?, period ILIKE ?)
--   • frequency_losers(market=?, change_type IN (...))
--
-- Single-column indexes on origin/destination/change_type/period still exist
-- from migration 001 and remain useful; these composites accelerate the hot
-- combined-filter queries without duplicating the simple lookups.

-- Covers: (origin, change_type, period) — powers new_route_launches when the
-- airport is the origin and carrier_capacity_ranking when market is origin.
CREATE INDEX IF NOT EXISTS idx_route_changes_origin_type_period
  ON route_changes (origin, change_type, comparison_period);

-- Covers: (destination, change_type, period) — mirror of the above for the
-- destination side of a market query, since market filter is (origin=? OR destination=?).
CREATE INDEX IF NOT EXISTS idx_route_changes_destination_type_period
  ON route_changes (destination, change_type, comparison_period);

-- Covers: (comparison_period prefix-match) — the ILIKE 'YYYY-Qn%' pattern is
-- index-friendly only when a btree on the left-anchored value exists.
CREATE INDEX IF NOT EXISTS idx_route_changes_comparison_period_prefix
  ON route_changes (comparison_period text_pattern_ops);

-- Covers: LEFT JOIN carriers c ON c.iata_code = rc.carrier used by every
-- route_changes query. Already exists on PK (carriers.iata_code) but we add
-- a covering index on rc.carrier for the join side.
CREATE INDEX IF NOT EXISTS idx_route_changes_carrier_join
  ON route_changes (carrier);

-- Covers: MAX(source_vintage) / (origin OR destination) scan used by
-- getLatestSourceVintage() in every tool call.
CREATE INDEX IF NOT EXISTS idx_route_snapshots_origin_vintage
  ON route_snapshots (origin, source_vintage DESC);

CREATE INDEX IF NOT EXISTS idx_route_snapshots_destination_vintage
  ON route_snapshots (destination, source_vintage DESC);
