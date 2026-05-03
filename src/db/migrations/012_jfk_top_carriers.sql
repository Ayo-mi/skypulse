-- SkyPulse Migration 012
-- Last sweep: carriers that appear in the JFK top-50 ranking and are
-- in seed.ts but never made it past the ensureCarriers() placeholder
-- on prod. Same upsert pattern as 007/008/010/011.
--
-- Catches the remaining "Unknown (auto)" entries the round-4 reviewer
-- would see when calling carrier_capacity_ranking on a major hub like
-- JFK: VS / AT / KU / LY / N0 / TA / JU / UX / Z0 / NOS / etc.

INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type) VALUES
    ('VS', 'VIR', 'Virgin Atlantic',               'GB', 'mainline'),
    ('AT', 'RAM', 'Royal Air Maroc',               'MA', 'mainline'),
    ('KU', 'KAC', 'Kuwait Airways',                'KW', 'mainline'),
    ('LY', 'ELY', 'El Al',                         'IL', 'mainline'),
    ('TA', 'TAI', 'TACA / Avianca El Salvador',    'SV', 'mainline'),
    ('JU', 'ASL', 'Air Serbia',                    'RS', 'mainline'),
    ('UX', 'AEA', 'Air Europa',                    'ES', 'mainline'),
    ('NOS', 'NBT', 'Norse Atlantic Airways',       'NO', 'mainline'),
    ('N0', 'NCR', 'National Airlines (alias)',     'US', 'cargo'),
    ('Z0', 'CKS', 'Kalitta Air (alias)',           'US', 'cargo'),
    -- Already-in-seed but-not-in-prod sweep
    ('SU', 'AFL', 'Aeroflot',                      'RU', 'mainline'),
    ('MS', 'MSR', 'EgyptAir',                      'EG', 'mainline'),
    ('WY', 'OMA', 'Oman Air',                      'OM', 'mainline'),
    ('UL', 'ALK', 'SriLankan Airlines',            'LK', 'mainline'),
    ('BG', 'BBC', 'Biman Bangladesh Airlines',     'BD', 'mainline'),
    ('PK', 'PIA', 'Pakistan International Airlines','PK','mainline'),
    ('BY', 'TOM', 'TUI Airways',                   'GB', 'lowcost'),
    ('DE', 'CFG', 'Condor',                        'DE', 'lowcost'),
    ('EW', 'EWG', 'Eurowings',                     'DE', 'lowcost'),
    ('DY', 'NOZ', 'Norwegian Air Shuttle',         'NO', 'lowcost'),
    ('FR', 'RYR', 'Ryanair',                       'IE', 'lowcost'),
    ('U2', 'EZY', 'easyJet',                       'GB', 'lowcost'),
    ('LD', 'AHK', 'AHK Air Hong Kong',             'HK', 'cargo'),
    ('QY', 'BCS', 'European Air Transport (DHL)',  'BE', 'cargo'),
    ('NW', 'NWA', 'Northern Air Cargo',            'US', 'cargo'),
    ('7L', 'CMB', 'Cargojet Airways',              'CA', 'cargo'),
    ('BB', 'SBS', 'Seaborne Airlines',             'US', 'regional'),
    ('B7', 'UIA', 'Uni Air',                       'TW', 'regional'),
    ('Z8', 'AZN', 'Amaszonas',                     'BO', 'regional'),
    ('OB', 'BOV', 'BoA (Boliviana de Aviación)',   'BO', 'mainline'),
    ('9R', 'SLI', 'SATENA',                        'CO', 'regional'),
    ('VW', 'TAO', 'Aeromar',                       'MX', 'regional'),
    ('6E', 'IGO', 'IndiGo',                        'IN', 'lowcost'),
    ('UK', 'VTI', 'Vistara',                       'IN', 'mainline'),
    ('NS', 'CSH', 'Hawaiian Air Cargo',            'US', 'cargo'),
    ('PD', 'POE', 'Porter Airlines',               'CA', 'mainline'),
    ('B8', 'EAL', 'Eastern Airlines',              'US', 'mainline'),
    ('XE', 'XSR', 'JSX',                           'US', 'lowcost'),
    ('TN', 'THT', 'Air Tahiti Nui',                'PF', 'mainline'),
    ('HU', 'CHH', 'Hainan Airlines',               'CN', 'mainline'),
    ('CU', 'CUB', 'Cubana de Aviacion',            'CU', 'mainline')
ON CONFLICT (iata_code) DO UPDATE SET
    icao_code    = EXCLUDED.icao_code,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    carrier_type = EXCLUDED.carrier_type;
