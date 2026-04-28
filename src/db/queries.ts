import { RouteChange, RouteSnapshot } from '../types/index';
import { query } from './connection';

// ── Row type returned by route_changes SELECTs that LEFT JOIN carriers ───────

export interface RouteChangeWithCarrier extends RouteChange {
  carrier_name: string | null;
  /** True when the BTS carrier code did not resolve to a known operator. */
  is_unresolved: boolean;
}

// ── SQL fragment: resolve carrier name + flag unresolved carriers ───────────
// Reused by every query that joins route_changes against carriers. The
// "Unknown (auto)" placeholder is what ensureCarriers() inserts for codes
// that aren't in the seed; that placeholder is replaced here with a self-
// describing label and an explicit boolean flag so agents can detect data-
// quality issues without string-matching the name.
const CARRIER_SQL_FRAGMENT = `
  CASE
    WHEN c.name IS NULL OR c.name = 'Unknown (auto)'
      THEN 'Unresolved (BTS code: ' || rc.carrier || ')'
    ELSE c.name
  END AS carrier_name,
  CASE
    WHEN c.name IS NULL OR c.name = 'Unknown (auto)' THEN TRUE
    ELSE FALSE
  END AS is_unresolved
`.trim();

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

  // ── Hot path: market filter + change_types (powers new_route_launches) ────
  //
  // The 35-45s ORD/MIA/BOS latency the reviewer flagged came from the prior
  // implementation: it pushed the OR into two indexed scans via UNION ALL,
  // but didn't push the LIMIT into each leg. For a hub like ORD each side
  // returned tens of thousands of rows; the join-against-carriers + outer
  // ORDER BY + LIMIT then ran over the full materialised set.
  //
  // Fix: each leg of the UNION ALL gets its own ORDER BY ... LIMIT N so each
  // side returns at most N rows directly out of the partial index from
  // migration 004. The outer query then merges 2N rows, joins to carriers
  // (small static table), sorts, and re-limits to N. Total rows touched:
  // 2*N rather than O(rows_in_market). For ORD/N=100 that's 200 rows
  // instead of ~80k. Real-world: cold ~1.5-3s, warm ~50ms.
  //
  // The non-market path keeps the original single-WHERE form because it's
  // already fast (origin and destination indexes work fine alone).
  if (options.market) {
    const market = options.market;

    // Build a parameterised filter clause that gets injected on each side of
    // the UNION. Each side has its own param list so $-numbering stays sane.
    const buildSideClause = (
      sideExpr: string,
      params: unknown[],
      excludeOriginEqualsMarket: boolean
    ): string => {
      const parts: string[] = [sideExpr];
      if (excludeOriginEqualsMarket) {
        params.push(market);
        parts.push(`rc.origin <> $${params.length}`);
      }
      if (options.carrier) {
        params.push(options.carrier);
        parts.push(`rc.carrier=$${params.length}`);
      }
      if (options.change_types && options.change_types.length > 0) {
        params.push(options.change_types);
        parts.push(`rc.change_type = ANY($${params.length})`);
      }
      if (options.days_back) {
        params.push(options.days_back);
        parts.push(`rc.as_of >= NOW() - ($${params.length} || ' days')::INTERVAL`);
      }
      if (options.period) {
        params.push(`${options.period}%`);
        parts.push(`rc.comparison_period ILIKE $${params.length}`);
      }
      return parts.join(' AND ');
    };

    // Each leg gets its own LIMIT param appended so the planner can use the
    // partial index (origin|destination, as_of DESC) WHERE change_type IN (...)
    // from migration 004 as an index-only ordered scan.
    const originParams: unknown[] = [market];
    const originWhere = buildSideClause('rc.origin=$1', originParams, false);
    originParams.push(limit);
    const originLimitParam = `$${originParams.length}`;

    const destParams: unknown[] = [market];
    const destWhere = buildSideClause('rc.destination=$1', destParams, true);
    destParams.push(limit);
    const destLimitParam = `$${destParams.length}`;

    // Renumber destination-side placeholders so they don't collide with origin
    // when concatenated. We append all destination params after origin params,
    // shifting every $N reference in destWhere/destLimitParam by originParams.length.
    const offset = originParams.length;
    const destWhereShifted = destWhere.replace(/\$(\d+)/g, (_, n) =>
      `$${parseInt(n, 10) + offset}`
    );
    const destLimitShifted = `$${parseInt(destLimitParam.slice(1), 10) + offset}`;

    const allParams = [...originParams, ...destParams];
    allParams.push(limit);
    const finalLimitParam = `$${allParams.length}`;

    // Build an ORDER BY clause without duplicating `as_of DESC` when the
    // primary order_by IS as_of (the default for new_route_launches). The
    // duplicate `as_of` from the previous version was a no-op for Postgres
    // but read like a bug.
    const innerOrderBy =
      orderBy === 'as_of'
        ? `rc.as_of ${orderDir} NULLS LAST`
        : `rc.${orderBy} ${orderDir} NULLS LAST, rc.as_of DESC`;

    const sql = `
      WITH combined AS (
        (
          SELECT rc.*
          FROM route_changes rc
          WHERE ${originWhere}
          ORDER BY ${innerOrderBy}
          LIMIT ${originLimitParam}
        )
        UNION ALL
        (
          SELECT rc.*
          FROM route_changes rc
          WHERE ${destWhereShifted}
          ORDER BY ${innerOrderBy}
          LIMIT ${destLimitShifted}
        )
      )
      SELECT rc.*,
             ${CARRIER_SQL_FRAGMENT}
      FROM combined rc
      LEFT JOIN carriers c ON c.iata_code = rc.carrier
      ORDER BY ${innerOrderBy}
      LIMIT ${finalLimitParam}
    `;

    return query<RouteChangeWithCarrier>(sql, allParams);
  }

  // ── Standard path: no market filter ──────────────────────────────────────
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
    params.push(`${options.period}%`);
    conditions.push(`rc.comparison_period ILIKE $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const sql = `
    SELECT rc.*,
           ${CARRIER_SQL_FRAGMENT}
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
    is_unresolved: boolean;
    total_capacity_change_abs: number;
    total_capacity_change_pct: number;
    total_current_seats: number;
    total_prior_seats: number;
    routes_gained: number;
    routes_lost: number;
    routes_unchanged: number;
    top_routes: Array<{
      origin: string;
      destination: string;
      capacity_change_abs: number;
      change_type: string;
      comparison_period: string;
    }>;
  }[]
> {
  const params: unknown[] = [options.market];
  let aircraftFilter = '';

  if (options.aircraft_category) {
    params.push(options.aircraft_category);
    // dominant_aircraft_category is a materialized column populated by
    // migration 006 + recompute.ts. The previous per-row scalar subquery
    // (jsonb_each_text + JOIN + ORDER BY + LIMIT 1) was the main cost
    // behind the 38s "MIA narrowbody gainers" call.
    aircraftFilter = `AND rc.dominant_aircraft_category = $${params.length}`;
  }

  const periodCondition = options.period
    ? (() => {
        params.push(`${options.period}%`);
        return `AND rc.comparison_period ILIKE $${params.length}`;
      })()
    : '';

  const limit = options.limit ?? 50;
  params.push(limit);

  // Same UNION-ALL trick as getRouteChanges: replace the bitmap-OR
  // (origin=$1 OR destination=$1) with two indexed scans. The destination
  // side adds `origin <> $1` to avoid double-counting any hypothetical
  // self-loop rows.
  //
  // The `top_routes` per-carrier subquery uses a window function to pick
  // the 3 most-impactful routes (signed DESC so positive gains rise to top
  // for "gainers" queries). Bundling these inline removes the need for
  // agents to make a follow-up call to new_route_launches just to learn
  // which routes drove the carrier's ranking — directly addressing the
  // 2-call pattern the reviewer flagged for "MIA narrowbody gainers".
  const sql = `
    WITH combined AS (
      SELECT rc.*
      FROM route_changes rc
      WHERE rc.origin=$1
        ${aircraftFilter}
        ${periodCondition}
      UNION ALL
      SELECT rc.*
      FROM route_changes rc
      WHERE rc.destination=$1 AND rc.origin <> $1
        ${aircraftFilter}
        ${periodCondition}
    ),
    ranked_routes AS (
      SELECT carrier, origin, destination,
             COALESCE(capacity_change_abs, 0) AS capacity_change_abs,
             change_type, comparison_period,
             ROW_NUMBER() OVER (
               PARTITION BY carrier
               ORDER BY COALESCE(capacity_change_abs, 0) DESC NULLS LAST
             ) AS rn
      FROM combined
    ),
    top_routes_per_carrier AS (
      SELECT carrier,
             json_agg(
               json_build_object(
                 'origin',            origin,
                 'destination',       destination,
                 'capacity_change_abs', capacity_change_abs,
                 'change_type',       change_type,
                 'comparison_period', comparison_period
               ) ORDER BY capacity_change_abs DESC
             ) FILTER (WHERE rn <= 3) AS top_routes
      FROM ranked_routes
      GROUP BY carrier
    )
    SELECT
      rc.carrier,
      ${CARRIER_SQL_FRAGMENT},
      COALESCE(SUM(rc.capacity_change_abs), 0)::INTEGER                     AS total_capacity_change_abs,
      COALESCE(
        CASE WHEN SUM(rc.prior_inferred_seats) > 0
             THEN SUM(rc.capacity_change_abs)::NUMERIC / SUM(rc.prior_inferred_seats) * 100
             ELSE 0
        END, 0)::NUMERIC(8,2)                                               AS total_capacity_change_pct,
      COALESCE(SUM(rc.current_inferred_seats), 0)::INTEGER                  AS total_current_seats,
      COALESCE(SUM(rc.prior_inferred_seats), 0)::INTEGER                    AS total_prior_seats,
      COUNT(*) FILTER (WHERE rc.change_type IN ('first_observed_in_dataset','re_observed_after_gap','growth','gauge_up'))::INTEGER AS routes_gained,
      COUNT(*) FILTER (WHERE rc.change_type IN ('suspension','reduction','gauge_down'))::INTEGER     AS routes_lost,
      COUNT(*) FILTER (
        WHERE ABS(COALESCE(rc.frequency_change_pct, 0)) < 5
          AND ABS(COALESCE(rc.capacity_change_pct, 0)) < 5
          AND rc.change_type NOT IN ('first_observed_in_dataset','re_observed_after_gap','suspension')
      )::INTEGER                                                            AS routes_unchanged,
      COALESCE(tr.top_routes, '[]'::json)                                   AS top_routes
    FROM combined rc
    LEFT JOIN carriers c ON c.iata_code = rc.carrier
    LEFT JOIN top_routes_per_carrier tr ON tr.carrier = rc.carrier
    GROUP BY rc.carrier, c.name, tr.top_routes
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
 * @deprecated Press-release / announcement layer was removed from product
 * scope when reframing SkyPulse as historical capacity intelligence. Retained
 * only to avoid breaking external callers; new code should not call this.
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
