import { RouteChange, RouteSnapshot } from '../types/index';
import { query } from './connection';

// ── Row type returned by route_changes SELECTs that LEFT JOIN carriers ───────

export interface RouteChangeWithCarrier extends RouteChange {
  carrier_name: string | null;
}

// ── Route snapshots ──────────────────────────────────────────────────────────

export async function upsertRouteSnapshot(
  snap: Omit<RouteSnapshot, 'id' | 'ingested_at'>
): Promise<void> {
  await query(
    `INSERT INTO route_snapshots
       (origin, destination, carrier, period, period_type, frequency,
        inferred_seats, aircraft_type_mix, source, source_vintage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (origin, destination, carrier, period, source)
     DO UPDATE SET
       period_type       = EXCLUDED.period_type,
       frequency         = EXCLUDED.frequency,
       inferred_seats    = EXCLUDED.inferred_seats,
       aircraft_type_mix = EXCLUDED.aircraft_type_mix,
       source_vintage    = EXCLUDED.source_vintage,
       ingested_at       = NOW()`,
    [
      snap.origin,
      snap.destination,
      snap.carrier,
      snap.period,
      snap.period_type,
      snap.frequency,
      snap.inferred_seats ?? null,
      snap.aircraft_type_mix ? JSON.stringify(snap.aircraft_type_mix) : null,
      snap.source,
      snap.source_vintage ?? null,
    ]
  );
}

/**
 * Ensure placeholder rows exist in `airports` for every IATA code passed.
 * Real reference data (via seed) wins on conflict; unknown codes get a
 * minimal row so route_snapshots FK checks don't fail. Returns inserted count.
 */
export async function ensureAirports(codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;
  const unique = [...new Set(codes.filter((c) => c && c.length <= 3))];
  if (unique.length === 0) return 0;
  const placeholders = unique.map((_, i) => `($${i + 1}, 'Unknown (auto)', 'Unknown', 'ZZ')`).join(', ');
  const res = await query<{ iata_code: string }>(
    `INSERT INTO airports (iata_code, name, city, country)
     VALUES ${placeholders}
     ON CONFLICT (iata_code) DO NOTHING
     RETURNING iata_code`,
    unique
  );
  return res.length;
}

/**
 * Same idea for carriers.
 */
export async function ensureCarriers(codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;
  // BTS UNIQUE_CARRIER is 2-3 chars (IATA or DOT/ICAO short-code). Allow both.
  const unique = [...new Set(codes.filter((c) => c && c.length >= 2 && c.length <= 3))];
  if (unique.length === 0) return 0;
  const placeholders = unique
    .map((_, i) => `($${i + 1}, 'Unknown (auto)', 'ZZ', 'other')`)
    .join(', ');
  const res = await query<{ iata_code: string }>(
    `INSERT INTO carriers (iata_code, name, country, carrier_type)
     VALUES ${placeholders}
     ON CONFLICT (iata_code) DO NOTHING
     RETURNING iata_code`,
    unique
  );
  return res.length;
}

export async function getSnapshotsByRoute(
  origin: string,
  destination: string,
  carrier?: string
): Promise<RouteSnapshot[]> {
  const params: unknown[] = [origin, destination];
  let sql = `SELECT * FROM route_snapshots WHERE origin=$1 AND destination=$2`;
  if (carrier) {
    params.push(carrier);
    sql += ` AND carrier=$${params.length}`;
  }
  sql += ` ORDER BY period DESC`;
  return query<RouteSnapshot>(sql, params);
}

// ── Route changes ────────────────────────────────────────────────────────────

export async function upsertRouteChange(
  change: Omit<RouteChange, 'id' | 'computed_at'>
): Promise<void> {
  await query(
    `INSERT INTO route_changes
       (origin, destination, carrier, comparison_period,
        prior_frequency, current_frequency, frequency_change_abs, frequency_change_pct,
        prior_inferred_seats, current_inferred_seats, capacity_change_abs, capacity_change_pct,
        aircraft_type_mix_prior, aircraft_type_mix_current,
        change_type, as_of, confidence, known_unknowns, source_refs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT DO NOTHING`,
    [
      change.origin,
      change.destination,
      change.carrier,
      change.comparison_period,
      change.prior_frequency ?? null,
      change.current_frequency ?? null,
      change.frequency_change_abs ?? null,
      change.frequency_change_pct ?? null,
      change.prior_inferred_seats ?? null,
      change.current_inferred_seats ?? null,
      change.capacity_change_abs ?? null,
      change.capacity_change_pct ?? null,
      change.aircraft_type_mix_prior
        ? JSON.stringify(change.aircraft_type_mix_prior)
        : null,
      change.aircraft_type_mix_current
        ? JSON.stringify(change.aircraft_type_mix_current)
        : null,
      change.change_type,
      change.as_of,
      change.confidence,
      change.known_unknowns ?? null,
      JSON.stringify(change.source_refs),
    ]
  );
}

/**
 * Query route_changes with flexible filters. Always joins carriers so every
 * returned row has `carrier_name` populated when a reference row exists.
 *
 * `period` is matched with a prefix ILIKE because the stored comparison_period
 * format is always "YYYY-Qn vs YYYY-Qn" or "YYYY-Qn (launch)" — a prefix match
 * is both correct and index-friendly.
 */
export async function getRouteChanges(options: {
  origin?: string;
  destination?: string;
  carrier?: string;
  change_types?: string[];
  days_back?: number;
  market?: string;
  period?: string;
  limit?: number;
  order_by?: string;
  order_dir?: 'ASC' | 'DESC';
}): Promise<RouteChangeWithCarrier[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.origin) {
    params.push(options.origin);
    conditions.push(`rc.origin=$${params.length}`);
  }
  if (options.destination) {
    params.push(options.destination);
    conditions.push(`rc.destination=$${params.length}`);
  }
  if (options.carrier) {
    params.push(options.carrier);
    conditions.push(`rc.carrier=$${params.length}`);
  }
  if (options.change_types && options.change_types.length > 0) {
    params.push(options.change_types);
    conditions.push(`rc.change_type = ANY($${params.length})`);
  }
  if (options.days_back) {
    params.push(options.days_back);
    conditions.push(`rc.as_of >= NOW() - ($${params.length} || ' days')::INTERVAL`);
  }
  if (options.period) {
    // comparison_period always starts with the current-quarter label, so a
    // prefix match avoids over-counting when a prior quarter coincidentally
    // contains the same substring (e.g. "2025-Q1 vs 2024-Q1" under "2024-Q1").
    params.push(`${options.period}%`);
    conditions.push(`rc.comparison_period ILIKE $${params.length}`);
  }
  if (options.market) {
    params.push(options.market);
    conditions.push(
      `(rc.origin=$${params.length} OR rc.destination=$${params.length})`
    );
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Whitelist order_by to prevent SQL injection via user-controlled string.
  const ORDER_BY_ALLOWED = new Set([
    'as_of',
    'comparison_period',
    'frequency_change_pct',
    'frequency_change_abs',
    'capacity_change_pct',
    'capacity_change_abs',
    'confidence',
  ]);
  const orderBy = ORDER_BY_ALLOWED.has(options.order_by ?? '')
    ? (options.order_by as string)
    : 'as_of';
  const orderDir = options.order_dir === 'ASC' ? 'ASC' : 'DESC';
  const limit = options.limit ?? 100;
  params.push(limit);

  // NULL out the `Unknown (auto)` placeholder from ensureCarriers() so the
  // string never leaks into agent-visible responses. The raw carrier IATA
  // code is always available, and downstream synthesis handles NULL names
  // gracefully.
  const sql = `
    SELECT rc.*,
           CASE WHEN c.name = 'Unknown (auto)' THEN NULL ELSE c.name END AS carrier_name
    FROM route_changes rc
    LEFT JOIN carriers c ON c.iata_code = rc.carrier
    ${where}
    ORDER BY rc.${orderBy} ${orderDir} NULLS LAST, rc.as_of DESC
    LIMIT $${params.length}
  `;

  return query<RouteChangeWithCarrier>(sql, params);
}

/**
 * Per-carrier capacity aggregates for a market. The aircraft_category filter
 * is applied against the dominant aircraft type in aircraft_type_mix_current
 * (the one with the most departures), not an arbitrary JSON key.
 *
 * `routes_unchanged` counts rows that are numerically flat: |freq pct| < 5 AND
 * |capacity pct| < 5 AND not a launch/resumption/suspension transition. The
 * former formula (NOT IN whole enum) was always zero.
 */
export async function getCarrierCapacityAggregates(options: {
  market: string;
  aircraft_category?: string;
  period?: string;
  limit?: number;
}): Promise<
  {
    carrier: string;
    carrier_name: string | null;
    total_capacity_change_abs: number;
    total_capacity_change_pct: number;
    total_current_seats: number;
    total_prior_seats: number;
    routes_gained: number;
    routes_lost: number;
    routes_unchanged: number;
  }[]
> {
  const params: unknown[] = [options.market];
  let aircraftFilter = '';

  if (options.aircraft_category) {
    params.push(options.aircraft_category);
    aircraftFilter = `
      AND (
        SELECT at2.category
        FROM jsonb_each_text(COALESCE(rc.aircraft_type_mix_current, '{}'::jsonb)) AS m(k, v)
        LEFT JOIN aircraft_types at2 ON at2.iata_type_code = m.k
        ORDER BY v::int DESC NULLS LAST
        LIMIT 1
      ) = $${params.length}
    `;
  }

  const periodCondition = options.period
    ? (() => {
        params.push(`${options.period}%`);
        return `AND rc.comparison_period ILIKE $${params.length}`;
      })()
    : '';

  const limit = options.limit ?? 50;
  params.push(limit);

  const sql = `
    SELECT
      rc.carrier,
      CASE WHEN c.name = 'Unknown (auto)' THEN NULL ELSE c.name END AS carrier_name,
      COALESCE(SUM(rc.capacity_change_abs), 0)::INTEGER                     AS total_capacity_change_abs,
      COALESCE(
        CASE WHEN SUM(rc.prior_inferred_seats) > 0
             THEN SUM(rc.capacity_change_abs)::NUMERIC / SUM(rc.prior_inferred_seats) * 100
             ELSE 0
        END, 0)::NUMERIC(8,2)                                               AS total_capacity_change_pct,
      COALESCE(SUM(rc.current_inferred_seats), 0)::INTEGER                  AS total_current_seats,
      COALESCE(SUM(rc.prior_inferred_seats), 0)::INTEGER                    AS total_prior_seats,
      COUNT(*) FILTER (WHERE rc.change_type IN ('launch','resumption','growth','gauge_up'))::INTEGER AS routes_gained,
      COUNT(*) FILTER (WHERE rc.change_type IN ('suspension','reduction','gauge_down'))::INTEGER     AS routes_lost,
      COUNT(*) FILTER (
        WHERE ABS(COALESCE(rc.frequency_change_pct, 0)) < 5
          AND ABS(COALESCE(rc.capacity_change_pct, 0)) < 5
          AND rc.change_type NOT IN ('launch','resumption','suspension')
      )::INTEGER                                                            AS routes_unchanged
    FROM route_changes rc
    LEFT JOIN carriers c ON c.iata_code = rc.carrier
    WHERE (rc.origin=$1 OR rc.destination=$1)
      ${aircraftFilter}
      ${periodCondition}
    GROUP BY rc.carrier, c.name
    ORDER BY total_capacity_change_abs DESC
    LIMIT $${params.length}
  `;

  return query(sql, params);
}

// ── Freshness helpers ────────────────────────────────────────────────────────

/**
 * Fetch the latest (most recent) source_vintage for a query scope. Used by
 * tools to build a dynamic data_freshness label that reflects actual data
 * age rather than a hardcoded string.
 */
export async function getLatestSourceVintage(options: {
  origin?: string;
  destination?: string;
  carrier?: string;
  market?: string;
}): Promise<Date | null> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (options.origin) {
    params.push(options.origin);
    conds.push(`origin=$${params.length}`);
  }
  if (options.destination) {
    params.push(options.destination);
    conds.push(`destination=$${params.length}`);
  }
  if (options.carrier) {
    params.push(options.carrier);
    conds.push(`carrier=$${params.length}`);
  }
  if (options.market) {
    params.push(options.market);
    conds.push(`(origin=$${params.length} OR destination=$${params.length})`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query<{ max: Date | null }>(
    `SELECT MAX(source_vintage) AS max FROM route_snapshots ${where}`,
    params
  );
  return rows[0]?.max ?? null;
}

/**
 * Fetch the most recent announced_date for a query scope (for the freshness
 * label: "Press Releases through <month year>").
 */
export async function getLatestAnnouncedDate(options: {
  origin?: string;
  destination?: string;
  carrier?: string;
  market?: string;
}): Promise<Date | null> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (options.origin) {
    params.push(options.origin);
    conds.push(`origin=$${params.length}`);
  }
  if (options.destination) {
    params.push(options.destination);
    conds.push(`destination=$${params.length}`);
  }
  if (options.carrier) {
    params.push(options.carrier);
    conds.push(`carrier=$${params.length}`);
  }
  if (options.market) {
    params.push(options.market);
    conds.push(`(origin=$${params.length} OR destination=$${params.length})`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query<{ max: Date | null }>(
    `SELECT MAX(announced_date) AS max FROM route_announcements ${where}`,
    params
  );
  return rows[0]?.max ?? null;
}
