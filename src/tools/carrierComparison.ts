import { z } from 'zod';
import {
  getRouteChanges,
  getLatestSourceVintage,
} from '../db/queries';
import { getOrSet, buildCacheKey } from '../cache/redis';
import { buildFreshnessMetadata } from '../utils/freshness';
import {
  FrequencyLosersInput,
  FrequencyLosersResult,
  FrequencyLoserEntry,
} from '../types/index';
import { logger } from '../utils/logger';

export const FrequencyLosersSchema = z.object({
  market: z
    .string()
    .min(3)
    .max(3)
    .optional()
    .describe('IATA airport code to scope the leaderboard (optional)'),
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
      'Maximum number of loser routes to return (default 30, max 100). Hub airports can have 100+ reduction rows; the default keeps payloads small enough for fast LLM synthesis. Increase up to 100 when the full list is needed.'
    ),
});

export type FrequencyLosersSchemaType = z.infer<typeof FrequencyLosersSchema>;

const LEADERBOARD_TTL = 6 * 3600; // 6 hours for leaderboards
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function frequencyLosers(
  input: FrequencyLosersInput
): Promise<FrequencyLosersResult> {
  const market = input.market?.toUpperCase();
  const period = input.period;
  // Same pattern as new_route_launches: always fetch the indexed top-100,
  // then trim in JS so the cache stays cheap and the LLM-facing payload
  // is small. Cache key includes the limit so default (top-30) and
  // explicit-100 calls do not collide.
  const requestedLimit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const cacheKey = buildCacheKey('frequency_losers', {
    market: market ?? '',
    period: period ?? '',
    limit: String(requestedLimit),
  });

  return getOrSet(cacheKey, LEADERBOARD_TTL, async () => {
    logger.info('Executing frequency_losers', { market, period, limit: requestedLimit });

    const [changes, latestVintage] = await Promise.all([
      getRouteChanges({
        market,
        change_types: ['reduction', 'suspension', 'gauge_down'],
        period,
        limit: MAX_LIMIT,
        order_by: 'frequency_change_pct',
        order_dir: 'ASC',
      }),
      getLatestSourceVintage(market ? { market } : {}),
    ]);

    const filteredChanges = changes.filter(
      (c) =>
        c.frequency_change_pct !== null &&
        c.prior_frequency !== null &&
        c.current_frequency !== null
    );
    const totalAvailable = filteredChanges.length;
    const trimmedChanges = filteredChanges.slice(0, requestedLimit);

    const losers: FrequencyLoserEntry[] = trimmedChanges
      .map((c) => ({
        origin: c.origin,
        destination: c.destination,
        carrier: c.carrier,
        carrier_name: c.carrier_name ?? undefined,
        is_unresolved: c.is_unresolved,
        comparison_period: c.comparison_period,
        frequency_change_pct: parseFloat(String(c.frequency_change_pct)),
        frequency_change_abs: c.frequency_change_abs ?? 0,
        prior_frequency: c.prior_frequency ?? 0,
        current_frequency: c.current_frequency ?? 0,
        confidence: parseFloat(String(c.confidence)),
      }));

    const allSources = trimmedChanges.flatMap((c) => c.source_refs);
    const avgConfidence =
      losers.length > 0
        ? losers.reduce((sum, l) => sum + l.confidence, 0) / losers.length
        : 0;

    const periods = [...new Set(trimmedChanges.map((c) => c.comparison_period))];
    const comparisonPeriod = periods.join(', ') || 'N/A';

    const truncatedNote =
      totalAvailable > losers.length
        ? ` Returning top ${losers.length} of ${totalAvailable} matching reductions ranked by frequency_change_pct ASC; pass limit (max 100) to retrieve more.`
        : '';
    const baseUnknowns =
      losers.length === 0
        ? 'No frequency reductions found in the requested scope'
        : 'Rankings based on historical BTS T-100 data (3–6 month public release lag).';

    const freshness = buildFreshnessMetadata({
      comparison_period: comparisonPeriod,
      source_refs: allSources.slice(0, 10),
      confidence: Math.round(avgConfidence * 100) / 100,
      known_unknowns: `${baseUnknowns}${truncatedNote}`,
      latestDataVintage: latestVintage,
    });

    return {
      market: market ?? null,
      period: period ?? null,
      losers,
      total_available: totalAvailable,
      limit_applied: requestedLimit,
      ...freshness,
    };
  });
}
