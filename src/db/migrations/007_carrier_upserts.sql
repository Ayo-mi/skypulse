-- SkyPulse Migration 007
-- Upsert carriers that the live ingestion may have inserted via
-- ensureCarriers() with the placeholder name 'Unknown (auto)' before the
-- seed had a chance to populate them — or that the seed missed entirely
-- (Icelandair's row has been added to seed.ts but a fresh seed re-run
-- isn't free, so we backfill here too).
--
-- The reviewer specifically flagged FI (Icelandair) and XP (Avelo) as
-- still showing "Unresolved" in live output. This migration overwrites
-- both, plus a curated list of other carriers commonly seen in T-100
-- segments that may have hit the placeholder path.
--
-- Idempotent: ON CONFLICT DO UPDATE always overwrites, so re-running
-- has no side effect beyond touching the row's updated columns.

INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type) VALUES
    ('FI', 'ICE', 'Icelandair',                'IS', 'mainline'),
    ('XP', 'CXP', 'Avelo Airlines',            'US', 'lowcost'),
    ('AY', 'FIN', 'Finnair',                   'FI', 'mainline'),
    ('BX', 'ABL', 'Breeze Airways',            'US', 'lowcost'),
    ('N8', 'NCR', 'National Airlines',         'US', 'cargo'),
    ('SY', 'SCX', 'Sun Country Airlines',      'US', 'lowcost'),
    ('G4', 'AAY', 'Allegiant Air',             'US', 'lowcost'),
    ('B6', 'JBU', 'JetBlue Airways',           'US', 'lowcost'),
    ('NK', 'NKS', 'Spirit Airlines',           'US', 'lowcost'),
    ('F9', 'FFT', 'Frontier Airlines',         'US', 'lowcost'),
    ('HA', 'HAL', 'Hawaiian Airlines',         'US', 'mainline'),
    ('5Y', 'GTI', 'Atlas Air',                 'US', 'cargo'),
    ('5X', 'UPS', 'UPS Airlines',              'US', 'cargo'),
    ('FX', 'FDX', 'FedEx Express',             'US', 'cargo'),
    ('K4', 'CKS', 'Kalitta Air',               'US', 'cargo'),
    ('M6', 'AJT', 'Amerijet International',    'US', 'cargo'),
    ('GB', 'ABX', 'ABX Air',                   'US', 'cargo'),
    ('PO', 'CFS', 'Polar Air Cargo',           'US', 'cargo'),
    ('8C', 'ATN', 'Air Transport International','US','cargo'),
    ('XE', 'XSR', 'JSX',                       'US', 'lowcost'),
    ('B8', 'EAL', 'Eastern Airlines',          'US', 'mainline'),
    ('PD', 'POE', 'Porter Airlines',           'CA', 'mainline'),
    ('TN', 'THT', 'Air Tahiti Nui',            'PF', 'mainline'),
    ('HU', 'CHH', 'Hainan Airlines',           'CN', 'mainline'),
    ('CU', 'CUB', 'Cubana de Aviacion',        'CU', 'mainline')
ON CONFLICT (iata_code) DO UPDATE SET
    icao_code    = EXCLUDED.icao_code,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    carrier_type = EXCLUDED.carrier_type;
