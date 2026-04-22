import { z } from 'zod';
import {
  getRouteChanges,
  getLatestSourceVintage,
  getLatestAnnouncedDate,
} from '../db/queries';
import { getOrSet, buildCacheKey } from '../cache/redis';
import { buildFreshnessMetadata } from '../utils/freshness';
import {
  CapacityDriverAnalysisInput,
  CapacityDriverAnalysisResult,
  CapacityDriverDetail,
} from '../types/index';
import { logger } from '../utils/logger';

export const CapacityDriverAnalysisSchema = z.object({
  origin: z.string().min(3).max(3).describe('IATA origin airport code'),
  destination: z.string().min(3).max(3).describe('IATA destination airport code'),
  carrier: z
    .string()
    .min(2)
    .max(2)
    .optional()
    .describe('IATA carrier code (optional, returns all carriers if omitted)'),
});

export type CapacityDriverAnalysisSchemaType = z.infer<typeof CapacityDriverAnalysisSchema>;

const DEFAULT_TTL = 3600;

function determineDriver(
  freqPct: number | null,
  capPct: number | null
): CapacityDriverDetail['driver'] {
  if (freqPct === null && capPct === null) return 'flat';

  const freqChange = freqPct ?? 0;
  const capChange = capPct ?? 0;

  if (Math.abs(freqChange) < 5 && Math.abs(capChange) < 5) return 'flat';
  if (freqChange < -5 || capChange < -5) return 'decline';

  if (freqChange > 0 && capChange > 0) {
    if (capChange - freqChange > 10) return 'gauge_driven';
    if (freqChange - capChange > 10) return 'frequency_driven';
    return 'mixed';
  }

  if (freqChange > 5 && capChange <= 0) return 'frequency_driven';
  if (capChange > 5 && freqChange <= 0) return 'gauge_driven';

  return 'mixed';
}

export async function capacityDriverAnalysis(
  input: CapacityDriverAnalysisInput
): Promise<CapacityDriverAnalysisResult> {
  const origin = input.origin.toUpperCase();
  const destination = input.destination.toUpperCase();
  const carrier = input.carrier?.toUpperCase();

  const cacheKey = buildCacheKey('capacity_driver_analysis', {
    origin,
    destination,
    carrier: carrier ?? '',
  });

  return getOrSet(cacheKey, DEFAULT_TTL, async () => {
    logger.info('Executing capacity_driver_analysis', { origin, destination, carrier });

    const [changes, latestVintage, latestAnnounce] = await Promise.all([
      getRouteChanges({
        origin,
        destination,
        carrier,
        limit: 100,
        order_by: 'as_of',
        order_dir: 'DESC',
      }),
      getLatestSourceVintage({ origin, destination, carrier }),
      getLatestAnnouncedDate({ origin, destination, carrier }),
    ]);

    const details: CapacityDriverDetail[] = changes.map((c) => {
      const freqPct =
        c.frequency_change_pct !== null
          ? parseFloat(String(c.frequency_change_pct))
          : null;
      const capPct =
        c.capacity_change_pct !== null
          ? parseFloat(String(c.capacity_change_pct))
          : null;

      return {
        carrier: c.carrier,
        carrier_name: c.carrier_name ?? undefined,
        comparison_period: c.comparison_period,
        driver: determineDriver(freqPct, capPct),
        frequency_change_pct: freqPct,
        capacity_change_pct: capPct,
        aircraft_type_mix_prior: c.aircraft_type_mix_prior,
        aircraft_type_mix_current: c.aircraft_type_mix_current,
        confidence: parseFloat(String(c.confidence)),
        known_unknowns: c.known_unknowns,
      };
    });

    const allSources = changes.flatMap((c) => c.source_refs);
    const avgConfidence =
      details.length > 0
        ? details.reduce((sum, d) => sum + d.confidence, 0) / details.length
        : 0;

    const periods = [...new Set(changes.map((c) => c.comparison_period))];
    const comparisonPeriod = periods.join(', ') || 'N/A';
    const hasMix = changes.some(
      (c) =>
        c.aircraft_type_mix_current &&
        Object.keys(c.aircraft_type_mix_current).length > 0
    );

    const freshness = buildFreshnessMetadata({
      comparison_period: comparisonPeriod,
      source_refs: allSources.slice(0, 10),
      confidence: Math.round(avgConfidence * 100) / 100,
      known_unknowns:
        details.length === 0
          ? 'No data found for this route'
          : !hasMix
          ? 'Aircraft mix data missing — gauge analysis may be inaccurate'
          : 'Coverage limited to ingested T-100 periods (3–6 month public release lag)',
      latestDataVintage: latestVintage,
      latestAnnouncementDate: latestAnnounce,
    });

    return {
      origin,
      destination,
      carrier: carrier ?? null,
      analysis: details,
      ...freshness,
    };
  });
}
