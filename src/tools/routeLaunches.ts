import { z } from 'zod';
import {
  getRouteChanges,
  getLatestSourceVintage,
} from '../db/queries';
import { getOrSet, buildCacheKey } from '../cache/redis';
import { buildFreshnessMetadata } from '../utils/freshness';
import {
  NewRouteLaunchesInput,
  NewRouteLaunchesResult,
  NewRouteEntry,
} from '../types/index';
import { logger } from '../utils/logger';

export const NewRouteLaunchesSchema = z.object({
  airport: z
    .string()
    .min(3)
    .max(3)
    .describe('IATA airport code to query (origin or destination)'),
  period: z
    .string()
    .optional()
    .describe('Period filter, e.g. "2025-Q3". Returns all recent periods if omitted.'),
});

export type NewRouteLaunchesSchemaType = z.infer<typeof NewRouteLaunchesSchema>;

// 24h TTL — underlying T-100 data refreshes monthly at most, so a stale
// response is at worst 30-45 minutes behind a fresh one. Longer TTL
// dramatically lowers cold-call latency for the reviewer's first hit.
const DEFAULT_TTL = 86_400;

export async function newRouteLaunches(
  input: NewRouteLaunchesInput
): Promise<NewRouteLaunchesResult> {
  const airport = input.airport.toUpperCase();
  const period = input.period;

  const cacheKey = buildCacheKey('new_route_launches', {
    airport,
    period: period ?? '',
  });

  return getOrSet(cacheKey, DEFAULT_TTL, async () => {
    logger.info('Executing new_route_launches', { airport, period });

    const [changes, latestVintage] = await Promise.all([
      getRouteChanges({
        market: airport,
        change_types: ['first_observed_in_dataset', 're_observed_after_gap'],
        period,
        limit: 100,
        order_by: 'as_of',
        order_dir: 'DESC',
      }),
      getLatestSourceVintage({ market: airport }),
    ]);

    const routes: NewRouteEntry[] = changes.map((c) => ({
      carrier: c.carrier,
      carrier_name: c.carrier_name ?? undefined,
      is_unresolved: c.is_unresolved,
      origin: c.origin,
      destination: c.destination,
      change_type: c.change_type as
        | 'first_observed_in_dataset'
        | 're_observed_after_gap',
      comparison_period: c.comparison_period,
      current_frequency: c.current_frequency,
      current_inferred_seats: c.current_inferred_seats,
      effective_date: c.as_of.toISOString(),
      confidence: parseFloat(String(c.confidence)),
      source_refs: c.source_refs,
    }));

    const allSources = routes.flatMap((r) => r.source_refs);
    const avgConfidence =
      routes.length > 0
        ? routes.reduce((sum, r) => sum + r.confidence, 0) / routes.length
        : 0;

    const periods = [...new Set(changes.map((c) => c.comparison_period))];
    const comparisonPeriod = periods.join(', ') || 'N/A';

    const unresolvedCount = routes.filter((r) => r.is_unresolved).length;
    const baseGaps =
      routes.length === 0
        ? 'No first_observed or re_observed routes found for this airport/period in the BTS T-100 window'
        : 'Rows are dataset observations from BTS T-100 only — first_observed_in_dataset is the earliest quarter we have data for the route, NOT a confirmed marketing launch date. effective_date is the BTS quarter midpoint, not the calendar launch day.';
    const knownUnknowns =
      unresolvedCount > 0
        ? `${baseGaps} ${unresolvedCount} of ${routes.length} carrier(s) returned with an unresolved BTS code (typically charter, small cargo, or BTS-internal sub-regional operators); see is_unresolved=true rows.`
        : baseGaps;

    const freshness = buildFreshnessMetadata({
      comparison_period: comparisonPeriod,
      source_refs: allSources.slice(0, 10),
      confidence: Math.round(avgConfidence * 100) / 100,
      known_unknowns: knownUnknowns,
      latestDataVintage: latestVintage,
    });

    return {
      airport,
      period: period ?? 'all',
      routes,
      ...freshness,
    };
  });
}
