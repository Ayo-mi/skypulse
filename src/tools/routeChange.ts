import { z } from 'zod';
import {
  getRouteChanges,
  getLatestSourceVintage,
} from '../db/queries';
import { getOrSet, buildCacheKey } from '../cache/redis';
import { buildFreshnessMetadata } from '../utils/freshness';
import {
  RouteCapacityChangeInput,
  RouteCapacityChangeResult,
  RouteChangeDetail,
} from '../types/index';
import { logger } from '../utils/logger';

export const RouteCapacityChangeSchema = z.object({
  origin: z.string().min(3).max(3).describe('IATA origin airport code (e.g. JFK)'),
  destination: z
    .string()
    .min(3)
    .max(3)
    .describe('IATA destination airport code (e.g. LAX)'),
  days_back: z
    .number()
    .int()
    .min(1)
    .max(730)
    .optional()
    .describe('Look back N days (default 365)'),
});

export type RouteCapacityChangeSchemaType = z.infer<typeof RouteCapacityChangeSchema>;

const DEFAULT_TTL = 3600; // 1 hour

export async function routeCapacityChange(
  input: RouteCapacityChangeInput
): Promise<RouteCapacityChangeResult> {
  const origin = input.origin.toUpperCase();
  const destination = input.destination.toUpperCase();
  const daysBack = input.days_back ?? 365;

  const cacheKey = buildCacheKey('route_capacity_change', {
    origin,
    destination,
    days_back: daysBack,
  });

  return getOrSet(cacheKey, DEFAULT_TTL, async () => {
    logger.info('Executing route_capacity_change', { origin, destination, daysBack });

    const [changes, latestVintage] = await Promise.all([
      getRouteChanges({
        origin,
        destination,
        days_back: daysBack,
        limit: 50,
        order_by: 'as_of',
        order_dir: 'DESC',
      }),
      getLatestSourceVintage({ origin, destination }),
    ]);

    const details: RouteChangeDetail[] = changes.map((c) => ({
      carrier: c.carrier,
      carrier_name: c.carrier_name ?? undefined,
      is_unresolved: c.is_unresolved,
      comparison_period: c.comparison_period,
      change_type: c.change_type,
      prior_frequency: c.prior_frequency,
      current_frequency: c.current_frequency,
      frequency_change_abs: c.frequency_change_abs,
      frequency_change_pct:
        c.frequency_change_pct !== null
          ? parseFloat(String(c.frequency_change_pct))
          : null,
      prior_inferred_seats: c.prior_inferred_seats,
      current_inferred_seats: c.current_inferred_seats,
      capacity_change_abs: c.capacity_change_abs,
      capacity_change_pct:
        c.capacity_change_pct !== null
          ? parseFloat(String(c.capacity_change_pct))
          : null,
      aircraft_type_mix_prior: c.aircraft_type_mix_prior,
      aircraft_type_mix_current: c.aircraft_type_mix_current,
      confidence: parseFloat(String(c.confidence)),
      known_unknowns: c.known_unknowns,
      source_refs: c.source_refs,
    }));

    const allSources = details.flatMap((d) => d.source_refs);
    const avgConfidence =
      details.length > 0
        ? details.reduce((sum, d) => sum + d.confidence, 0) / details.length
        : 0;

    const periods = details.map((d) => d.comparison_period);
    const comparisonPeriod =
      periods.length > 0 ? [...new Set(periods)].join(', ') : 'N/A';

    const unresolvedCount = details.filter((d) => d.is_unresolved).length;
    const baseGaps =
      details.length === 0
        ? 'No route-change data found for this origin/destination in the requested window'
        : 'Historical BTS T-100 only (3–6 month public release lag). first_observed_in_dataset rows reflect the earliest BTS quarter the route appears in our window — not a confirmed marketing launch date.';
    const knownUnknowns =
      unresolvedCount > 0
        ? `${baseGaps} ${unresolvedCount} of ${details.length} carrier(s) returned with an unresolved BTS code (typically charter, small cargo, or BTS-internal sub-regional operators); see is_unresolved=true rows.`
        : baseGaps;

    const freshness = buildFreshnessMetadata({
      comparison_period: comparisonPeriod,
      source_refs: allSources.slice(0, 10),
      confidence: Math.round(avgConfidence * 100) / 100,
      known_unknowns: knownUnknowns,
      latestDataVintage: latestVintage,
    });

    return {
      origin,
      destination,
      changes: details,
      ...freshness,
    };
  });
}
