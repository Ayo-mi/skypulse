import { z } from 'zod';
import {
  getCarrierCapacityAggregates,
  getLatestSourceVintage,
} from '../db/queries';
import { getOrSet, buildCacheKey } from '../cache/redis';
import { buildFreshnessMetadata } from '../utils/freshness';
import {
  CarrierCapacityRankingInput,
  CarrierCapacityRankingResult,
  CarrierRankEntry,
  SourceRef,
} from '../types/index';
import { logger } from '../utils/logger';

export const CarrierCapacityRankingSchema = z.object({
  market: z
    .string()
    .min(3)
    .max(3)
    .describe('IATA airport code defining the market (origin or destination)'),
  aircraft_category: z
    .enum(['narrowbody', 'widebody', 'regional_jet', 'turboprop', 'other'])
    .optional()
    .describe('Filter by aircraft category'),
  period: z
    .string()
    .optional()
    .describe('Period filter, e.g. "2025-Q3". Returns all recent periods if omitted.'),
});

export type CarrierCapacityRankingSchemaType = z.infer<typeof CarrierCapacityRankingSchema>;

const LEADERBOARD_TTL = 6 * 3600; // 6 hours

export async function carrierCapacityRanking(
  input: CarrierCapacityRankingInput
): Promise<CarrierCapacityRankingResult> {
  const market = input.market.toUpperCase();
  const aircraftCategory = input.aircraft_category;
  const period = input.period;

  const cacheKey = buildCacheKey('carrier_capacity_ranking', {
    market,
    aircraft_category: aircraftCategory ?? '',
    period: period ?? '',
  });

  return getOrSet(cacheKey, LEADERBOARD_TTL, async () => {
    logger.info('Executing carrier_capacity_ranking', {
      market,
      aircraftCategory,
      period,
    });

    const [aggregates, latestVintage] = await Promise.all([
      getCarrierCapacityAggregates({
        market,
        aircraft_category: aircraftCategory,
        period,
        limit: 50,
      }),
      getLatestSourceVintage({ market }),
    ]);

    const ranking: CarrierRankEntry[] = aggregates.map((agg, index) => ({
      rank: index + 1,
      carrier: agg.carrier,
      carrier_name: agg.carrier_name ?? undefined,
      is_unresolved: agg.is_unresolved,
      total_capacity_change_abs: Number(agg.total_capacity_change_abs),
      total_capacity_change_pct: Number(agg.total_capacity_change_pct),
      total_current_seats: Number(agg.total_current_seats),
      total_prior_seats: Number(agg.total_prior_seats),
      routes_gained: Number(agg.routes_gained),
      routes_lost: Number(agg.routes_lost),
      routes_unchanged: Number(agg.routes_unchanged),
    }));

    // Confidence is derived from the data we actually have: more carriers in
    // the market = better coverage; a recent vintage boosts confidence.
    const coverageConfidence = ranking.length === 0 ? 0 : Math.min(0.5 + ranking.length * 0.05, 0.85);
    const ageDays = latestVintage
      ? Math.floor((Date.now() - latestVintage.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;
    const ageBonus = ageDays === undefined ? -0.05 : ageDays > 365 ? -0.1 : ageDays <= 120 ? 0.05 : 0;
    const confidence = Math.max(
      0,
      Math.min(1, Math.round((coverageConfidence + ageBonus) * 100) / 100)
    );

    const sourceRefs: SourceRef[] = [];
    if (latestVintage) {
      sourceRefs.push({
        source: 'BTS T-100',
        vintage: formatVintage(latestVintage),
      });
    }

    const freshness = buildFreshnessMetadata({
      comparison_period: period ?? 'all available quarters in scope',
      source_refs: sourceRefs,
      confidence,
      known_unknowns:
        ranking.length === 0
          ? 'No carrier capacity data found for this market/filter'
          : 'Rankings aggregated from BTS T-100 historical data (3–6 month public release lag). Codeshare allocation not fully attributed. Some carriers may appear with the IATA code only when the BTS code does not resolve to a known operator.',
      latestDataVintage: latestVintage,
    });

    return {
      market,
      aircraft_category: aircraftCategory ?? null,
      period: period ?? null,
      ranking,
      ...freshness,
    };
  });
}

function formatVintage(vintage: Date): string {
  const year = vintage.getUTCFullYear();
  const q = Math.ceil((vintage.getUTCMonth() + 1) / 3);
  return `${year}-Q${q}`;
}
