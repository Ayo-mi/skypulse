-- SkyPulse Initial Schema
-- Migration 001

-- ── Reference tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS airports (
    iata_code   VARCHAR(3)   PRIMARY KEY,
    icao_code   VARCHAR(4),
    name        VARCHAR(255) NOT NULL,
    city        VARCHAR(100) NOT NULL,
    country     VARCHAR(2)   NOT NULL DEFAULT 'US',
    metro_area  VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS carriers (
    iata_code    VARCHAR(2)   PRIMARY KEY,
    icao_code    VARCHAR(3),
    name         VARCHAR(255) NOT NULL,
    country      VARCHAR(2)   NOT NULL DEFAULT 'US',
    carrier_type VARCHAR(20)  NOT NULL DEFAULT 'other'
        CHECK (carrier_type IN ('mainline','regional','lowcost','charter','cargo','other'))
);

CREATE TABLE IF NOT EXISTS aircraft_types (
    iata_type_code         VARCHAR(10)  PRIMARY KEY,
    manufacturer           VARCHAR(100) NOT NULL,
    model                  VARCHAR(100) NOT NULL,
    family                 VARCHAR(100),
    typical_seats_economy  INTEGER,
    typical_seats_total    INTEGER,
    category               VARCHAR(20)  NOT NULL DEFAULT 'other'
        CHECK (category IN ('narrowbody','widebody','regional_jet','turboprop','other'))
);

-- ── Core data tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS route_snapshots (
    id                 SERIAL       PRIMARY KEY,
    origin             VARCHAR(3)   NOT NULL REFERENCES airports(iata_code),
    destination        VARCHAR(3)   NOT NULL REFERENCES airports(iata_code),
    carrier            VARCHAR(2)   NOT NULL REFERENCES carriers(iata_code),
    period             VARCHAR(20)  NOT NULL,
    period_type        VARCHAR(20)  NOT NULL DEFAULT 'monthly'
        CHECK (period_type IN ('weekly','monthly','quarterly')),
    frequency          INTEGER      NOT NULL DEFAULT 0,
    inferred_seats     INTEGER,
    aircraft_type_mix  JSONB,
    source             VARCHAR(30)  NOT NULL
        CHECK (source IN ('dot_t100','faa_opsnet','announcement')),
    source_vintage     TIMESTAMP,
    ingested_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (origin, destination, carrier, period, source)
);

CREATE TABLE IF NOT EXISTS route_changes (
    id                        SERIAL        PRIMARY KEY,
    origin                    VARCHAR(3)    NOT NULL REFERENCES airports(iata_code),
    destination               VARCHAR(3)    NOT NULL REFERENCES airports(iata_code),
    carrier                   VARCHAR(2)    NOT NULL REFERENCES carriers(iata_code),
    comparison_period         VARCHAR(50)   NOT NULL,
    prior_frequency           INTEGER,
    current_frequency         INTEGER,
    frequency_change_abs      INTEGER,
    frequency_change_pct      NUMERIC(8,2),
    prior_inferred_seats      INTEGER,
    current_inferred_seats    INTEGER,
    capacity_change_abs       INTEGER,
    capacity_change_pct       NUMERIC(8,2),
    aircraft_type_mix_prior   JSONB,
    aircraft_type_mix_current JSONB,
    change_type               VARCHAR(20)   NOT NULL
        CHECK (change_type IN ('launch','suspension','resumption','growth','reduction','gauge_up','gauge_down')),
    as_of                     TIMESTAMP     NOT NULL DEFAULT NOW(),
    confidence                NUMERIC(3,2)  NOT NULL DEFAULT 0.5,
    known_unknowns            TEXT,
    source_refs               JSONB         NOT NULL DEFAULT '[]',
    computed_at               TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_announcements (
    id                 SERIAL       PRIMARY KEY,
    carrier            VARCHAR(2)   NOT NULL REFERENCES carriers(iata_code),
    origin             VARCHAR(3)   NOT NULL REFERENCES airports(iata_code),
    destination        VARCHAR(3)   NOT NULL REFERENCES airports(iata_code),
    announcement_type  VARCHAR(30)  NOT NULL
        CHECK (announcement_type IN ('launch','suspension','resumption','frequency_change')),
    effective_date     DATE,
    announced_date     DATE,
    source_url         TEXT,
    source_text        TEXT,
    processed          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_route_snapshots_origin_dest
    ON route_snapshots (origin, destination);

CREATE INDEX IF NOT EXISTS idx_route_snapshots_carrier
    ON route_snapshots (carrier);

CREATE INDEX IF NOT EXISTS idx_route_snapshots_period
    ON route_snapshots (period);

CREATE INDEX IF NOT EXISTS idx_route_changes_origin_dest
    ON route_changes (origin, destination);

CREATE INDEX IF NOT EXISTS idx_route_changes_carrier
    ON route_changes (carrier);

CREATE INDEX IF NOT EXISTS idx_route_changes_change_type
    ON route_changes (change_type);

CREATE INDEX IF NOT EXISTS idx_route_changes_period
    ON route_changes (comparison_period);

CREATE INDEX IF NOT EXISTS idx_route_changes_as_of
    ON route_changes (as_of);

CREATE INDEX IF NOT EXISTS idx_route_announcements_carrier
    ON route_announcements (carrier);

CREATE INDEX IF NOT EXISTS idx_route_announcements_origin_dest
    ON route_announcements (origin, destination);

CREATE INDEX IF NOT EXISTS idx_route_announcements_processed
    ON route_announcements (processed);
