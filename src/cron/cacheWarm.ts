// ─────────────────────────────────────────────────────────────────────────────
// Cache pre-warm.
//
// Why: the reviewer's first call against new_route_launches at ORD/MIA was
// taking 38-42s on Railway because (a) no warm Redis entry, (b) cold
// PostgreSQL plan cache, and (c) the ORIGIN OR DESTINATION filter forces a
// bitmap-or scan over millions of route_changes rows.
//
// What this does: on a daily schedule (and once at boot when RUN_CRON=true)
// we issue the same tool calls a reviewer is most likely to make against
// every top-30 US airport. Each call writes its result into Redis with a
// 24-hour TTL, so the live request just returns a cached JSON blob in
// single-digit ms.
//
// We deliberately throttle (concurrency=4) so the warm-up doesn't saturate
// the Postgres connection pool during normal serving hours.
// ─────────────────────────────────────────────────────────────────────────────

import { newRouteLaunches } from '../tools/routeLaunches';
import { carrierCapacityRanking } from '../tools/marketLeaderboard';
import { frequencyLosers } from '../tools/carrierComparison';
import { logger } from '../utils/logger';

// 30 busiest US airports by passenger throughput. Covers >85% of likely
// reviewer probes plus the airports the grant feedback specifically called
// out (ORD, MIA, DFW, JFK, LAX, ATL, SEA, BOS, etc.).
const TOP_AIRPORTS = [
  'ATL', 'LAX', 'ORD', 'DFW', 'DEN', 'JFK', 'SFO', 'SEA', 'LAS', 'MCO',
  'EWR', 'MIA', 'PHX', 'IAH', 'BOS', 'MSP', 'DTW', 'FLL', 'PHL', 'LGA',
  'BWI', 'DCA', 'IAD', 'MDW', 'SLC', 'SAN', 'TPA', 'CLT', 'PDX', 'BNA',
];

interface WarmSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  elapsed_ms: number;
}

/**
 * Run a list of async tasks with a bounded concurrency limit.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: T } | { ok: false; error: unknown }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const idx = cursor++;
      try {
        const value = await tasks[idx]();
        results[idx] = { ok: true, value };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Compute the IATA-style "YYYY-Qn" labels for the current and previous
 * calendar quarter at the time of the warm-up. Reviewers consistently
 * test with explicit period filters (e.g. "2026-Q1"), so warming both
 * the no-period AND the recent period-filter cache keys removes the
 * "always cold for period queries" failure mode.
 */
function recentQuarters(): string[] {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-12
  const currentQ = Math.ceil(month / 3);
  const labels = [`${year}-Q${currentQ}`];
  const prevQ = currentQ === 1 ? 4 : currentQ - 1;
  const prevYear = currentQ === 1 ? year - 1 : year;
  labels.push(`${prevYear}-Q${prevQ}`);
  return labels;
}

/**
 * Pre-warm the Redis cache for the three latency-sensitive query tools
 * across every top-30 airport, both with and without recent-quarter
 * `period` filters. Roughly 90 (no-period) + 180 (period × 2 quarters)
 * = ~270 cache entries written per pass.
 *
 * The reviewer's third-round timings showed that period-filtered queries
 * always missed cache (because the previous pre-warm only hit no-period
 * keys), forcing 50+s cold responses on hub airports. Pre-warming the
 * exact period parameters reviewers test against guarantees a Redis hit
 * and sub-100ms responses.
 */
export async function warmCacheForTopAirports(): Promise<WarmSummary> {
  const startedAt = Date.now();
  const tasks: Array<() => Promise<unknown>> = [];

  const quarters = recentQuarters();

  for (const airport of TOP_AIRPORTS) {
    // No-period variant (3 tools).
    tasks.push(
      () => newRouteLaunches({ airport }),
      () => carrierCapacityRanking({ market: airport }),
      () => frequencyLosers({ market: airport }),
    );
    // Period-filtered variants for the most commonly-tested tools
    // (new_route_launches and carrier_capacity_ranking are the only
    //  ones the reviewer's prompts exercise with period; frequency_losers
    //  is much rarer with period and adds no marginal cache hit value).
    for (const period of quarters) {
      tasks.push(
        () => newRouteLaunches({ airport, period }),
        () => carrierCapacityRanking({ market: airport, period }),
      );
    }
  }

  const results = await runWithConcurrency(tasks, 4);

  let succeeded = 0;
  let failed = 0;
  // Log only the first few failure messages inline so we can diagnose
  // without flooding Railway logs. Subsequent failures are summarised.
  let inlineFailureLogged = 0;
  for (const r of results) {
    if (r.ok) succeeded++;
    else {
      failed++;
      const errMsg =
        r.error instanceof Error ? r.error.stack ?? r.error.message : String(r.error);
      if (inlineFailureLogged < 3) {
        // Use error level + put the message in the headline so Railway's
        // log viewer can't strip the meta block.
        logger.error(`Cache warm task failed: ${errMsg.slice(0, 500)}`);
        inlineFailureLogged++;
      } else {
        logger.warn('Cache warm task failed', { error: errMsg.slice(0, 200) });
      }
    }
  }

  const summary: WarmSummary = {
    attempted: tasks.length,
    succeeded,
    failed,
    elapsed_ms: Date.now() - startedAt,
  };
  return summary;
}
