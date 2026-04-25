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
 * Pre-warm the Redis cache for the three latency-sensitive query tools
 * across every top-30 airport. Roughly 90 cache entries written per pass.
 */
export async function warmCacheForTopAirports(): Promise<WarmSummary> {
  const startedAt = Date.now();
  const tasks: Array<() => Promise<unknown>> = [];

  for (const airport of TOP_AIRPORTS) {
    tasks.push(
      () => newRouteLaunches({ airport }),
      () => carrierCapacityRanking({ market: airport }),
      () => frequencyLosers({ market: airport }),
    );
  }

  const results = await runWithConcurrency(tasks, 4);

  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) succeeded++;
    else {
      failed++;
      logger.warn('Cache warm task failed', { error: String(r.error) });
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
