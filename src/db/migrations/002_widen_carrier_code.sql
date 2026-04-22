-- SkyPulse Migration 002
-- Widen carrier IATA/ICAO code columns from VARCHAR(2) to VARCHAR(3).
--
-- Rationale: BTS T-100 reports some cargo and regional operators (e.g. ABX Air,
-- Ravn Connect, Vieques Air Link) with 3-character DOT/ICAO codes rather than a
-- 2-char IATA code. A VARCHAR(2) column silently drops these on insert and we
-- lose ~5-8% of route rows as a result.

ALTER TABLE route_snapshots     ALTER COLUMN carrier TYPE VARCHAR(3);
ALTER TABLE route_changes       ALTER COLUMN carrier TYPE VARCHAR(3);
ALTER TABLE route_announcements ALTER COLUMN carrier TYPE VARCHAR(3);
ALTER TABLE carriers            ALTER COLUMN iata_code TYPE VARCHAR(3);
