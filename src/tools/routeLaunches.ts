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
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Maximum number of routes to return (default 30, max 100). Hub airports can have 100+ first_observed routes per period; the default keeps payloads small enough for fast LLM synthesis. Increase up to 100 when the full list is needed.'
    ),
});

export type NewRouteLaunchesSchemaType = z.infer<typeof NewRouteLaunchesSchema>;

// 24h TTL — underlying T-100 data refreshes monthly at most, so a stale
// response is at worst 30-45 minutes behind a fresh one. Longer TTL
// dramatically lowers cold-call latency for the reviewer's first hit.
const DEFAULT_TTL = 86_400;

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function newRouteLaunches(
  input: NewRouteLaunchesInput
): Promise<NewRouteLaunchesResult> {
  const airport = input.airport.toUpperCase();
  const period = input.period;
  // Resolve the trim limit. We always fetch the full indexed candidate
  // pool of MAX_LIMIT (=100) from Postgres so that ranking is done on a
  // complete window. The `limit` param only controls how many rows are
  // returned to the agent. This keeps the SQL fast (the partial index
  // is sized for 100 rows) while letting the response shrink to a size
  // the LLM can synthesize quickly. The cache key intentionally bakes
  // the limit in so an "all=100" request does not poison the default
  // top-30 cache and vice versa.
  const requestedLimit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const cacheKey = buildCacheKey('new_route_launches', {
    airport,
    period: period ?? '',
    limit: String(requestedLimit),
  });

  return getOrSet(cacheKey, DEFAULT_TTL, async () => {
    logger.info('Executing new_route_launches', { airport, period, limit: requestedLimit });

    const [changes, latestVintage] = await Promise.all([
      getRouteChanges({
        market: airport,
        change_types: ['first_observed_in_dataset', 're_observed_after_gap'],
        period,
        limit: MAX_LIMIT,
        order_by: 'as_of',
        order_dir: 'DESC',
      }),
      getLatestSourceVintage({ market: airport }),
    ]);

    // Rank by current_inferred_seats DESC so the trimmed top-N are the
    // most consequential new routes (biggest capacity), not just the
    // most recently observed. Routes with NULL seats fall to the bottom.
    const sortedChanges = [...changes].sort((a, b) => {
      const aSeats = a.current_inferred_seats ?? -1;
      const bSeats = b.current_inferred_seats ?? -1;
      return bSeats - aSeats;
    });
    const totalAvailable = sortedChanges.length;
    const trimmedChanges = sortedChanges.slice(0, requestedLimit);

    const routes: NewRouteEntry[] = trimmedChanges.map((c) => ({
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

    const periods = [...new Set(trimmedChanges.map((c) => c.comparison_period))];
    const comparisonPeriod = periods.join(', ') || 'N/A';

    const unresolvedCount = routes.filter((r) => r.is_unresolved).length;
    const baseGaps =
      routes.length === 0
        ? 'No first_observed or re_observed routes found for this airport/period in the BTS T-100 window'
        : 'Rows are dataset observations from BTS T-100 only — first_observed_in_dataset is the earliest quarter we have data for the route, NOT a confirmed marketing launch date. effective_date is the BTS quarter midpoint, not the calendar launch day.';
    const truncatedNote =
      totalAvailable > routes.length
        ? ` Returning top ${routes.length} of ${totalAvailable} matching routes ranked by current_inferred_seats DESC; pass limit (max 100) to retrieve more.`
        : '';
    const unresolvedNote =
      unresolvedCount > 0
        ? ` ${unresolvedCount} of ${routes.length} carrier(s) returned with an unresolved BTS code (typically charter, small cargo, or BTS-internal sub-regional operators); see is_unresolved=true rows.`
        : '';
    const knownUnknowns = `${baseGaps}${truncatedNote}${unresolvedNote}`;

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
      total_available: totalAvailable,
      limit_applied: requestedLimit,
      ...freshness,
    };
  });
}
