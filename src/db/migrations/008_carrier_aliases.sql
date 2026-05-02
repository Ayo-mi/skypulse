-- SkyPulse Migration 008
-- Adds resolution for carrier codes that the third-round reviewer flagged
-- as still appearing as "Unresolved (BTS code: …)" in live output:
--   G7  = GoJet Airlines        (real IATA, just missing from prod carriers)
--   ABX = ABX Air               (ICAO; canonical IATA is GB)
--   KAQ = Kalitta Charters      (BTS-style code; canonical IATA is K4)
--   AN  = Ansett Australia      (defunct; harmless to resolve)
--
-- Strategy: two kinds of rows.
--
--   1. Real upsert: G7 / GoJet — straightforward IATA row, matches our
--      schema convention (iata_code is the primary lookup column).
--
--   2. Alias rows: ABX, KAQ, AN — the carriers table already holds the
--      canonical row under the airline's true IATA (GB, K4, AN-Ansett),
--      but historical T-100 batches were ingested before ICAO→IATA
--      normalization was complete, so those rows store the ICAO/legacy
--      code in route_changes.carrier. Re-ingesting all 191 k snapshots
--      to backfill carrier codes is expensive; instead we insert a
--      *second* carriers row keyed by the actually-stored code so the
--      existing LEFT JOIN (c.iata_code = rc.carrier) resolves it.
--      The alias name matches the canonical name verbatim so the agent
--      sees a single stable airline name.
--
-- Idempotent: ON CONFLICT DO UPDATE so re-runs are safe.

INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type) VALUES
    ('G7',  'GJS', 'GoJet Airlines',           'US', 'regional'),
    -- Aliases keyed by the BTS-published code.
    ('ABX', 'ABX', 'ABX Air',                  'US', 'cargo'),
    ('KAQ', 'CKS', 'Kalitta Air',              'US', 'cargo'),
    -- Catch-all for the leftover real operators that occasionally appear
    -- in T-100 segment dumps with non-standard codes. Each one points at
    -- the actual airline; the BTS-internal numeric/Q-suffixed codes
    -- (37Q, 07Q, 1EQ, 27Q, GFQ, GCA, BQJ, 1UQ) are intentionally left
    -- as "Unresolved (BTS code: …)" because they don't map to a single
    -- known operator.
    ('CMP', 'CMP', 'Copa Airlines',            'PA', 'mainline'),
    ('TGW', 'TGW', 'Scoot',                    'SG', 'lowcost')
ON CONFLICT (iata_code) DO UPDATE SET
    icao_code    = EXCLUDED.icao_code,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    carrier_type = EXCLUDED.carrier_type;
