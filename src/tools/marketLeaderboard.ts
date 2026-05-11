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
  // The aircraft_category accepts the explicit "all" sentinel plus the four
  // real fleet categories. We preprocess so any "neutral" value an LLM
  // orchestrator might pass (empty string, null, the literal word "any",
  // accidental whitespace) collapses to "all" rather than failing Zod
  // validation. The R6 reviewer documented an LLM that always picked "other"
  // when faced with an enum that lacked a neutral choice — adding "all" as a
  // first-class value (with a robust normalization layer) is the cleanest
  // way to guarantee single-call answers.
  aircraft_category: z
    .preprocess(
      (val) => {
        if (val === undefined || val === null) return 'all';
        if (typeof val === 'string') {
          const trimmed = val.trim().toLowerCase();
          if (trimmed === '' || trimmed === 'any' || trimmed === 'all') return 'all';
          return trimmed;
        }
        return val;
      },
      z.enum(['all', 'narrowbody', 'widebody', 'regional_jet', 'turboprop', 'other'])
    )
    .default('all')
    .describe(
      'Fleet filter. Pass "all" (the default) for the cross-fleet ranking — this is the correct answer for "Which carriers added the most capacity?" prompts. Restrict to a specific fleet only when the user explicitly asks (e.g. "narrowbody gainers"). Do NOT enumerate fleet values to reconstruct an all-fleet view.'
    ),
  period: z
    .string()
    .optional()
    .describe('Period filter, e.g. "2025-Q3". Returns all recent periods if omitted.'),
});

export type CarrierCapacityRankingSchemaType = z.infer<typeof CarrierCapacityRankingSchema>;

const LEADERBOARD_TTL = 6 * 3600; // 6 hours

// Values that mean "do not filter by aircraft category". Both the new "all"
// enum value and the absence of the parameter map to the unfiltered query
// path. We also accept an empty string defensively because some agent
// orchestrators pass `""` instead of omitting the field.
const ALL_AIRCRAFT_SENTINELS = new Set(['all', '', undefined]);

export async function carrierCapacityRanking(
  input: CarrierCapacityRankingInput
): Promise<CarrierCapacityRankingResult> {
  const market = input.market.toUpperCase();
  // Normalize the aircraft_category input. The R6 reviewer surfaced a
  // hard-to-debug failure mode: when aircraft_category was an enum without a
  // neutral value, the LLM orchestrator picked "other" as a default and got
  // an empty ranking, then enumerated the rest of the enum to reconstruct
  // the all-aircraft view (3-5 tool calls instead of 1). The fix is to
  // expose "all" as a first-class enum value AND treat it as "no filter"
  // server-side, so the LLM has a reachable, schema-compliant way to ask
  // for the cross-fleet ranking.
  const rawCategory = input.aircraft_category as string | undefined;
  const isAllAircraft = ALL_AIRCRAFT_SENTINELS.has(rawCategory);
  const aircraftCategoryFilter = isAllAircraft ? undefined : rawCategory;
  // Echo back the canonical label (`all` when no filter, the specific
  // category otherwise) so consumers can read the response and know
  // exactly what scope they got.
  const aircraftCategoryEcho = isAllAircraft ? 'all' : rawCategory;
  const period = input.period;

  const cacheKey = buildCacheKey('carrier_capacity_ranking', {
    market,
    // Cache key uses the canonical echo so "all", "" and absence collapse
    // to the same Redis entry — saves three trips' worth of cache space
    // and guarantees the pre-warm hit lands on the LLM-issued key.
    aircraft_category: aircraftCategoryEcho ?? 'all',
    period: period ?? '',
  });

  return getOrSet(cacheKey, LEADERBOARD_TTL, async () => {
    logger.info('Executing carrier_capacity_ranking', {
      market,
      aircraftCategory: aircraftCategoryEcho,
      period,
    });

    const [aggregates, latestVintage] = await Promise.all([
      getCarrierCapacityAggregates({
        market,
        aircraft_category: aircraftCategoryFilter,
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
      total_capacity_added_seats: Number(agg.total_capacity_added_seats),
      total_current_seats: Number(agg.total_current_seats),
      total_prior_seats: Number(agg.total_prior_seats),
      routes_gained: Number(agg.routes_gained),
      routes_lost: Number(agg.routes_lost),
      routes_unchanged: Number(agg.routes_unchanged),
      // top_routes is JSON-decoded server-side by node-pg. Coerce numbers
      // because Postgres returns capacity_change_abs as a string when the
      // value comes through json_agg.
      top_routes: (agg.top_routes ?? []).map((r) => ({
        origin: r.origin,
        destination: r.destination,
        capacity_change_abs: Number(r.capacity_change_abs),
        change_type: r.change_type,
        comparison_period: r.comparison_period,
      })),
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
      aircraft_category: aircraftCategoryEcho ?? 'all',
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
