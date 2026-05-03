-- SkyPulse Migration 010
-- Round-4 grant review feedback: several active carrier codes are still
-- showing as "Unresolved (BTS code: …)" in live output despite being
-- present in seed.ts (XL, 9K, EM, etc) — the seed only runs on a fresh
-- DB, and prod was first populated by ensureCarriers() with the
-- placeholder name 'Unknown (auto)'.
--
-- This migration upserts every carrier the reviewer flagged plus the
-- top-30 unresolved codes by frequency in the live route_changes table,
-- mapped to the real operator wherever a real operator exists.
--
-- Codes intentionally NOT included (BTS-internal numeric/Q-suffixed
-- codes that don't map to a single known operator and that we
-- explicitly label as Unresolved (BTS code: X) with is_unresolved=true):
--   27Q, 37Q, 13Q, 3EQ, 36Q, IFQ, GFQ, 1BQ, 1UQ, BQJ, AMQ
--
-- Idempotent: ON CONFLICT DO UPDATE always overwrites, so re-running
-- has no side effect beyond touching the row's columns.

INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type) VALUES
    -- Reviewer-flagged codes (round 4)
    ('XL', 'LNE', 'LATAM Ecuador',                 'EC', 'mainline'),
    ('S4', 'RZO', 'Azores Airlines',               'PT', 'mainline'),
    ('KX', 'CAY', 'Cayman Airways',                'KY', 'mainline'),
    -- High-frequency unresolved real operators in live route_changes
    ('TJ', 'TBA', 'Tradewind Aviation',            'US', 'regional'),
    ('6F', 'PRM', 'Primera Air',                   'IS', 'lowcost'),
    ('LF', 'VTE', 'Contour Airlines',              'US', 'regional'),
    ('VJT', 'VJT', 'VistaJet',                     'MT', 'charter'),
    ('GV', 'CDV', 'Grant Aviation',                'US', 'regional'),
    ('7S', 'RYA', 'Ryan Air Service (Alaska)',     'US', 'regional'),
    ('K2', 'EUL', 'Eurolot',                       'PL', 'regional'),
    ('8E', 'BRG', 'Bering Air',                    'US', 'regional'),
    ('5V', 'LYC', 'Lviv Airlines',                 'UA', 'mainline'),
    ('M5', 'KEN', 'Kenmore Air',                   'US', 'regional'),
    ('AN', 'WSN', 'Advanced Air',                  'US', 'regional'),
    ('U7', 'UGD', 'Air Uganda',                    'UG', 'mainline'),
    ('X9', 'SOX', 'Southern Skyways',              'US', 'regional'),
    ('4W', 'WSN', 'Warbelow''s Air Ventures',      'US', 'regional'),
    ('L2', 'LYD', 'Lynden Air Cargo',              'US', 'cargo'),
    ('QK', 'JZA', 'Jazz Aviation',                 'CA', 'regional'),
    ('TI', 'TWG', 'Tailwind Air',                  'US', 'regional'),
    ('KO', 'KMV', 'Komiaviatrans',                 'RU', 'regional'),
    ('9X', 'EJA', 'Southern Airways Express',      'US', 'regional'),
    -- Codes that were in seed.ts but never made it past the
    -- ensureCarriers() placeholder on prod (same fix pattern as G7
    -- in migration 008).
    ('9K', 'KAP', 'Cape Air',                      'US', 'regional'),
    ('EM', 'CFS', 'Empire Airlines',               'US', 'regional'),
    ('Q6', 'GLU', 'Aerolíneas Sosa',               'HN', 'regional'),
    ('MP', 'MPH', 'Martinair Cargo',               'NL', 'cargo'),
    ('7C', 'WSW', 'Western Global Airlines',       'US', 'cargo'),
    ('7H', 'RVF', 'Ravn Alaska',                   'US', 'regional'),
    ('JQ', 'JST', 'Jetstar Airways',               'AU', 'lowcost'),
    -- ICAO-style alias rows (BTS sometimes publishes the ICAO code
    -- instead of the IATA code; alias rows let LEFT JOIN ON iata_code
    -- match without re-ingesting). Country left blank-equivalent.
    ('GCA', 'GCA', 'GCA Charter (BTS code)',       'US', 'charter'),
    ('AMQ', 'AMQ', 'AMQ Charter (BTS code)',       'US', 'charter')
ON CONFLICT (iata_code) DO UPDATE SET
    icao_code    = EXCLUDED.icao_code,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    carrier_type = EXCLUDED.carrier_type;
