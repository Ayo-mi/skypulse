-- SkyPulse Migration 006
-- Materialize dominant_aircraft_category as a column on route_changes.
--
-- Why: getCarrierCapacityAggregates filters by aircraft_category using a
-- per-row scalar subquery that expands aircraft_type_mix_current as JSONB,
-- joins to aircraft_types, sorts by departure count, and takes the top
-- entry. For a hub like MIA that's tens of thousands of mini-queries
-- inside one outer query — the dominant cost behind the 38.8s
-- "MIA narrowbody gainers" call the reviewer flagged.
--
-- Fix: compute the dominant category once at insertion time (and once
-- here for existing rows) and store it as a regular column. The index on
-- (market-side, dominant_aircraft_category, change_type) then turns the
-- filter into a single index seek.
--
-- Trade-off: when aircraft_types reference data is updated, this column
-- can drift. We accept that — aircraft_types is rarely updated and the
-- dominant category for an existing aircraft mix will not change. New
-- rows always compute correctly via recompute.ts.

ALTER TABLE route_changes
    ADD COLUMN IF NOT EXISTS dominant_aircraft_category VARCHAR(20);

-- Backfill existing rows. The subquery is identical to the one in the
-- old getCarrierCapacityAggregates implementation, so cached behaviour
-- is preserved.
UPDATE route_changes rc
   SET dominant_aircraft_category = (
       SELECT at2.category
         FROM jsonb_each_text(COALESCE(rc.aircraft_type_mix_current, '{}'::jsonb)) AS m(k, v)
         LEFT JOIN aircraft_types at2 ON at2.iata_type_code = m.k
        ORDER BY v::int DESC NULLS LAST
        LIMIT 1
   )
 WHERE rc.aircraft_type_mix_current IS NOT NULL
   AND rc.dominant_aircraft_category IS NULL;

-- Compound indexes for the carrier_capacity_ranking hot path.
CREATE INDEX IF NOT EXISTS idx_route_changes_origin_aircraft_cat
    ON route_changes (origin, dominant_aircraft_category)
    WHERE dominant_aircraft_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_route_changes_destination_aircraft_cat
    ON route_changes (destination, dominant_aircraft_category)
    WHERE dominant_aircraft_category IS NOT NULL;

ANALYZE route_changes;
