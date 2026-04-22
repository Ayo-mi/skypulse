import { z } from 'zod';
import {
  getRouteChanges,
  getLatestSourceVintage,
  getLatestAnnouncedDate,
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
});

export type FrequencyLosersSchemaType = z.infer<typeof FrequencyLosersSchema>;

const LEADERBOARD_TTL = 6 * 3600; // 6 hours for leaderboards

export async function frequencyLosers(
  input: FrequencyLosersInput
): Promise<FrequencyLosersResult> {
  const market = input.market?.toUpperCase();
  const period = input.period;

  const cacheKey = buildCacheKey('frequency_losers', {
    market: market ?? '',
    period: period ?? '',
  });

  return getOrSet(cacheKey, LEADERBOARD_TTL, async () => {
    logger.info('Executing frequency_losers', { market, period });

    const [changes, latestVintage, latestAnnounce] = await Promise.all([
      getRouteChanges({
        market,
        change_types: ['reduction', 'suspension', 'gauge_down'],
        period,
        limit: 100,
        order_by: 'frequency_change_pct',
        order_dir: 'ASC',
      }),
      getLatestSourceVintage(market ? { market } : {}),
      getLatestAnnouncedDate(market ? { market } : {}),
    ]);

    const losers: FrequencyLoserEntry[] = changes
      .filter(
        (c) =>
          c.frequency_change_pct !== null &&
          c.prior_frequency !== null &&
          c.current_frequency !== null
      )
      .map((c) => ({
        origin: c.origin,
        destination: c.destination,
        carrier: c.carrier,
        carrier_name: c.carrier_name ?? undefined,
        comparison_period: c.comparison_period,
        frequency_change_pct: parseFloat(String(c.frequency_change_pct)),
        frequency_change_abs: c.frequency_change_abs ?? 0,
        prior_frequency: c.prior_frequency ?? 0,
        current_frequency: c.current_frequency ?? 0,
        confidence: parseFloat(String(c.confidence)),
      }));

    const allSources = changes.flatMap((c) => c.source_refs);
    const avgConfidence =
      losers.length > 0
        ? losers.reduce((sum, l) => sum + l.confidence, 0) / losers.length
        : 0;

    const periods = [...new Set(changes.map((c) => c.comparison_period))];
    const comparisonPeriod = periods.join(', ') || 'N/A';

    const freshness = buildFreshnessMetadata({
      comparison_period: comparisonPeriod,
      source_refs: allSources.slice(0, 10),
      confidence: Math.round(avgConfidence * 100) / 100,
      known_unknowns:
        losers.length === 0
          ? 'No frequency reductions found in the requested scope'
          : 'Rankings based on ingested T-100 data (3–6 month public release lag)',
      latestDataVintage: latestVintage,
      latestAnnouncementDate: latestAnnounce,
    });

    return {
      market: market ?? null,
      period: period ?? null,
      losers,
      ...freshness,
    };
  });
}
