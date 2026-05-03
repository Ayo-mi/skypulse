-- SkyPulse Migration 011
-- Long-tail real-operator carriers that still appear as Unresolved
-- in route_changes after migration 010 (under 200 row-count each but
-- visible in some markets). Same upsert pattern as 010.
--
-- Codes intentionally left alone (BTS-internal sub-regional /
-- numeric / Q-suffix codes that don't map to a single operator):
--   27Q, 37Q, 13Q, 3EQ, 36Q, IFQ, GFQ, 15Q, 3AQ

INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type) VALUES
    ('V8', 'VAS', 'ATRAN Aviatrans Cargo Airlines', 'RU', 'cargo'),
    ('J5', 'EUE', 'Alaska Seaplanes',              'US', 'regional'),
    ('2O', 'IAR', 'Island Air Service',            'US', 'regional'),
    ('K3', 'TQN', 'Taquan Air',                    'US', 'regional'),
    ('3S', 'GUY', 'Air Antilles',                  'GP', 'regional'),
    ('RV', 'ROU', 'Air Canada Rouge',              'CA', 'mainline'),
    ('SX', 'ABR', 'Skybus Jet Cargo',              'US', 'cargo'),
    ('I4', 'IFL', 'IFL Group',                     'US', 'cargo'),
    ('VK', 'IGE', 'Aerolane (defunct)',            'EC', 'mainline'),
    ('KH', 'AAH', 'Aloha Air Cargo',               'US', 'cargo'),
    ('3F', 'FLG', 'Flair Airlines',                'CA', 'lowcost'),
    ('WG', 'SWG', 'Sunwing Airlines',              'CA', 'charter'),
    ('OO', 'SKW', 'SkyWest Airlines',              'US', 'regional'),
    ('YV', 'ASH', 'Mesa Airlines',                 'US', 'regional'),
    ('YX', 'RPA', 'Republic Airways',              'US', 'regional'),
    ('OH', 'JIA', 'PSA Airlines',                  'US', 'regional'),
    ('9E', 'EDV', 'Endeavor Air',                  'US', 'regional'),
    ('MQ', 'ENY', 'Envoy Air',                     'US', 'regional'),
    ('OZ', 'AAR', 'Asiana Airlines',               'KR', 'mainline'),
    ('OL', 'OLG', 'OpenSkies (defunct)',           'GB', 'mainline'),
    ('UO', 'HKE', 'HK Express',                    'HK', 'lowcost')
ON CONFLICT (iata_code) DO UPDATE SET
    icao_code    = EXCLUDED.icao_code,
    name         = EXCLUDED.name,
    country      = EXCLUDED.country,
    carrier_type = EXCLUDED.carrier_type;
