// ─────────────────────────────────────────────────────────────────────────────
// Route-change recomputation pipeline.
//
// This is the analyst layer — the actual "premium answer product" that is
// being unbundled from OAG Schedules Analyser / Cirium Diio Mi.
//
// Input : rows in route_snapshots (one row per origin/destination/carrier/period/source)
// Output: rows in route_changes (one row per origin/destination/carrier/comparison_period)
//
// Strategy
// ─────────
//   For every (origin, destination, carrier) triple we:
//     1. Pull all snapshots ordered chronologically.
//     2. Roll monthly snapshots up to quarterly aggregates (frequency summed,
//        seats summed, aircraft mix merged). This preserves monthly ingestion
//        granularity while producing the market-intel unit OAG/Cirium sell.
//     3. Compare consecutive aggregate periods with classifyChange(), emitting
//        one route_changes row per transition.
//     4. Attach a confidence score based on available evidence and source
//        vintage age.
//     5. Invalidate relevant cache keys so the next query reflects new data.
//
// NOTE: Press-release / announcement corroboration was removed from the
// pipeline when SkyPulse was reframed as historical T-100 intelligence. The
// route_announcements table is retained for forward compatibility but no
// longer queried per row (saves ~1 DB round-trip per change).
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { query, withTransaction } from '../db/connection';
import { invalidatePattern } from '../cache/redis';
import { classifyChange } from '../normalization/changeDetection';
import {
  buildKnownUnknowns,
  computeConfidence,
} from '../normalization/confidenceScoring';
import { logger } from '../utils/logger';
import { RouteSnapshot, SourceRef } from '../types/index';

type PeriodType = 'monthly' | 'quarterly';

interface AggregateSnapshot {
  origin: string;
  destination: string;
  carrier: string;
  period: string; // canonical comparison unit: "YYYY-Qn"
  period_type: PeriodType;
  frequency: number;
  inferred_seats: number;
  aircraft_type_mix: Record<string, number>;
  source_refs: SourceRef[];
  source_vintage: Date | null;
}

/**
 * Convert a monthly or quarterly period label to the canonical quarterly key
 * used for comparisons. Monthly periods roll up to the containing quarter.
 */
function canonicalQuarter(period: string): string {
  // "2025-08" → "2025-Q3"
  const monthlyMatch = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthlyMatch) {
    const year = parseInt(monthlyMatch[1], 10);
    const month = parseInt(monthlyMatch[2], 10);
    const quarter = Math.ceil(month / 3);
    return `${year}-Q${quarter}`;
  }
  // "2025-Q3" → passthrough
  if (/^\d{4}-Q[1-4]$/.test(period)) return period;
  // unknown shape — leave as-is so we don't silently mis-bucket
  return period;
}

/**
 * Compare quarterly keys: "2025-Q2" < "2025-Q3" < "2026-Q1"
 */
function compareQuarters(a: string, b: string): number {
  const [ya, qa] = a.split('-Q').map((s) => parseInt(s, 10));
  const [yb, qb] = b.split('-Q').map((s) => parseInt(s, 10));
  if (ya !== yb) return ya - yb;
  return qa - qb;
}

/**
 * Group snapshots into quarterly aggregates, one per (origin, destination,
 * carrier, quarter). Source-level dedup: if multiple sources cover the same
 * (triple, quarter, month), dot_t100 wins over faa_opsnet and announcements
 * contribute source_refs without overwriting the numeric values.
 */
function aggregateSnapshotsByQuarter(
  snapshots: RouteSnapshot[]
): Map<string, AggregateSnapshot> {
  const agg = new Map<string, AggregateSnapshot>();

  for (const snap of snapshots) {
    if (snap.source === 'faa_opsnet' && snap.origin === snap.destination) {
      // OPSNET self-referential markers are not route-level; skip.
      continue;
    }
    if (snap.source === 'announcement') {
      // Announcements don't carry reliable numeric capacity; they contribute
      // corroboration only via the separate route_announcements table.
      continue;
    }

    const quarter = canonicalQuarter(snap.period);
    const key = `${snap.origin}:${snap.destination}:${snap.carrier}:${quarter}`;
    const existing = agg.get(key);
    const mix =
      snap.aircraft_type_mix && typeof snap.aircraft_type_mix === 'object'
        ? (snap.aircraft_type_mix as Record<string, number>)
        : {};

    if (!existing) {
      agg.set(key, {
        origin: snap.origin,
        destination: snap.destination,
        carrier: snap.carrier,
        period: quarter,
        period_type: 'quarterly',
        frequency: snap.frequency,
        inferred_seats: snap.inferred_seats ?? 0,
        aircraft_type_mix: { ...mix },
        source_refs: [
          {
            source: sourceLabel(snap.source),
            vintage: formatVintage(snap.source_vintage),
          },
        ],
        source_vintage: snap.source_vintage,
      });
      continue;
    }

    existing.frequency += snap.frequency;
    existing.inferred_seats += snap.inferred_seats ?? 0;
    for (const [code, count] of Object.entries(mix)) {
      existing.aircraft_type_mix[code] =
        (existing.aircraft_type_mix[code] ?? 0) + count;
    }
    if (
      snap.source_vintage &&
      (!existing.source_vintage || snap.source_vintage > existing.source_vintage)
    ) {
      existing.source_vintage = snap.source_vintage;
    }
    const label = sourceLabel(snap.source);
    if (!existing.source_refs.some((r) => r.source === label)) {
      existing.source_refs.push({
        source: label,
        vintage: formatVintage(snap.source_vintage),
      });
    }
  }

  return agg;
}

function sourceLabel(source: RouteSnapshot['source']): string {
  switch (source) {
    case 'dot_t100':
      return 'BTS T-100';
    case 'faa_opsnet':
      return 'FAA OPSNET';
    case 'announcement':
      return 'Press Release';
    default:
      return String(source);
  }
}

function formatVintage(vintage: Date | null): string {
  if (!vintage) return 'vintage unknown';
  const month = vintage.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
  const year = vintage.getFullYear();
  const quarter = Math.ceil((vintage.getMonth() + 1) / 3);
  return `Q${quarter} ${year} (period ${month})`;
}

interface RecomputeOptions {
  /** Limit recomputation to a single triple (useful in tests). */
  origin?: string;
  destination?: string;
  carrier?: string;
  /** How many comparison periods per triple to (re)emit. Defaults to all. */
  maxPeriods?: number;
  /** Skip the cache invalidation step (used by tests). */
  skipCacheInvalidation?: boolean;
}

/**
 * Recompute route_changes from the current route_snapshots state.
 * Existing rows for each (origin, destination, carrier, comparison_period)
 * are replaced atomically inside a transaction.
 */
export async function recomputeRouteChanges(
  opts: RecomputeOptions = {}
): Promise<{ changesWritten: number; triples: number }> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.origin) {
    params.push(opts.origin);
    conds.push(`origin = $${params.length}`);
  }
  if (opts.destination) {
    params.push(opts.destination);
    conds.push(`destination = $${params.length}`);
  }
  if (opts.carrier) {
    params.push(opts.carrier);
    conds.push(`carrier = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  const triples = await query<{
    origin: string;
    destination: string;
    carrier: string;
  }>(
    `SELECT DISTINCT origin, destination, carrier
     FROM route_snapshots
     ${where}
     ORDER BY origin, destination, carrier`,
    params
  );

  let changesWritten = 0;
  let tripleCount = 0;

  for (const t of triples) {
    const snapshots = await query<RouteSnapshot>(
      `SELECT * FROM route_snapshots
       WHERE origin=$1 AND destination=$2 AND carrier=$3
       ORDER BY period ASC`,
      [t.origin, t.destination, t.carrier]
    );

    const aggregates = [...aggregateSnapshotsByQuarter(snapshots).values()];
    aggregates.sort((a, b) => compareQuarters(a.period, b.period));

    if (aggregates.length < 1) continue;

    // Always emit a "first_observed_in_dataset" row for the earliest observed
    // quarter (or when prior = zero) and comparison rows for every subsequent
    // quarter.
    const emitCount = opts.maxPeriods
      ? Math.min(aggregates.length, opts.maxPeriods)
      : aggregates.length;
    const startIdx = Math.max(0, aggregates.length - emitCount);

    for (let i = startIdx; i < aggregates.length; i++) {
      const current = aggregates[i];
      const prior = i === 0 ? null : aggregates[i - 1];

      const comparisonPeriod =
        prior !== null
          ? `${current.period} vs ${prior.period}`
          : `${current.period} (first_observed)`;

      const classification = classifyChange({
        prior: prior
          ? aggregateToSnapshot(prior)
          : null,
        current: aggregateToSnapshot(current),
      });

      const comparisonBoundary = quarterMidpoint(current.period);

      const dataAgeDays = current.source_vintage
        ? Math.floor(
            (Date.now() - current.source_vintage.getTime()) / (1000 * 60 * 60 * 24)
          )
        : undefined;

      const confidence = computeConfidence({
        changeType: classification.changeType,
        sourceRefs: current.source_refs,
        dataAge_days: dataAgeDays,
        hasAircraftMixData:
          Object.keys(current.aircraft_type_mix).length > 0,
      });

      const knownUnknowns = buildKnownUnknowns({
        hasMixData: Object.keys(current.aircraft_type_mix).length > 0,
        sourceCount: current.source_refs.length,
        dataAge_days: dataAgeDays,
      });

      const sourceRefs: SourceRef[] = [...current.source_refs];

      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM route_changes
           WHERE origin=$1 AND destination=$2 AND carrier=$3 AND comparison_period=$4`,
          [t.origin, t.destination, t.carrier, comparisonPeriod]
        );
        await client.query(
          `INSERT INTO route_changes
             (origin, destination, carrier, comparison_period,
              prior_frequency, current_frequency, frequency_change_abs, frequency_change_pct,
              prior_inferred_seats, current_inferred_seats, capacity_change_abs, capacity_change_pct,
              aircraft_type_mix_prior, aircraft_type_mix_current,
              change_type, as_of, confidence, known_unknowns, source_refs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            t.origin,
            t.destination,
            t.carrier,
            comparisonPeriod,
            prior?.frequency ?? null,
            current.frequency,
            classification.frequencyChangeAbs,
            classification.frequencyChangePct,
            prior?.inferred_seats ?? null,
            current.inferred_seats,
            classification.capacityChangeAbs,
            classification.capacityChangePct,
            prior ? JSON.stringify(prior.aircraft_type_mix) : null,
            JSON.stringify(current.aircraft_type_mix),
            classification.changeType,
            comparisonBoundary,
            confidence,
            knownUnknowns,
            JSON.stringify(sourceRefs),
          ]
        );
      });

      changesWritten++;
    }

    tripleCount++;
  }

  if (!opts.skipCacheInvalidation) {
    await invalidatePattern('skypulse:*').catch((err) =>
      logger.warn('Cache invalidation failed after recompute', { error: String(err) })
    );
  }

  logger.info('Route change recomputation complete', {
    triples: tripleCount,
    changesWritten,
    scope: opts.origin
      ? `${opts.origin}-${opts.destination ?? '*'} / ${opts.carrier ?? '*'}`
      : 'all',
  });

  return { changesWritten, triples: tripleCount };
}

function aggregateToSnapshot(agg: AggregateSnapshot): RouteSnapshot {
  return {
    id: 0,
    origin: agg.origin,
    destination: agg.destination,
    carrier: agg.carrier,
    period: agg.period,
    period_type: agg.period_type,
    frequency: agg.frequency,
    inferred_seats: agg.inferred_seats,
    aircraft_type_mix: agg.aircraft_type_mix,
    source: 'dot_t100',
    source_vintage: agg.source_vintage,
    ingested_at: new Date(),
  };
}

function quarterMidpoint(quarter: string): Date {
  // "2025-Q3" → Aug 15, 2025 (middle of Q3)
  const [yStr, qStr] = quarter.split('-Q');
  const year = parseInt(yStr, 10);
  const q = parseInt(qStr, 10);
  const month = (q - 1) * 3 + 1; // 2nd month of the quarter (1-indexed)
  return new Date(Date.UTC(year, month, 15));
}

// Standalone runner: `npm run recompute`
if (require.main === module) {
  recomputeRouteChanges()
    .then((summary) => {
      logger.info('Recompute finished', summary);
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Recompute failed', { error: String(err) });
      process.exit(1);
    });
}
