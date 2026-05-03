import cron from 'node-cron';
import { logger } from '../utils/logger';
import { ingestT100FromSource } from '../ingestion/dotT100';
import { warmCacheForTopAirports } from './cacheWarm';

/**
 * Cron job schedule:
 *
 *  - Weekly (Sunday 02:00 UTC) : Re-ingest T-100 from T100_DATA_URL mirror, then
 *                                recompute route_changes and flush cache.
 *  - Daily  (07:00 UTC)        : Pre-warm Redis cache for the top airports so
 *                                the first agent call after the daily TTL roll
 *                                hits a hot cache (sub-second), not Postgres.
 *  - Hourly (every 30 min)     : Lightweight keep-alive — re-warms the top-3
 *                                hub airport cache entries. The actual goal
 *                                is preventing Railway from idling the
 *                                container down. A cold-start on Railway's
 *                                shared infra can add 10-30s to the very
 *                                first request, which the round-4 reviewer
 *                                misinterpreted as a "first call returns
 *                                incomplete data, retry triggered" pattern.
 *                                Keeping the container warm eliminates the
 *                                misread.
 *
 * The previous "daily announcement scan" job was removed when SkyPulse was
 * reframed as historical T-100 intelligence (no live press-release layer).
 *
 * All jobs are only installed when RUN_CRON=true, controlled by src/index.ts.
 * This lets operators scale horizontally without double-ingesting on every replica.
 */

export function startScheduler(): void {
  logger.info('Starting cron scheduler');

  // ── Weekly T-100 refresh ────────────────────────────────────────────────────
  cron.schedule('0 2 * * 0', async () => {
    logger.info('Cron: Weekly T-100 refresh starting');
    try {
      const url = process.env.T100_DATA_URL;
      if (!url) {
        logger.info(
          'Cron: T100_DATA_URL not configured — skipping T-100 refresh. ' +
            'Run `npm run ingest:t100 -- --file <path>` manually after each BTS release.'
        );
        return;
      }
      const summary = await ingestT100FromSource({ url });
      logger.info('Cron: T-100 refresh complete', summary);
    } catch (err) {
      logger.error('Cron: T-100 refresh failed', { error: String(err) });
    }
  });

  // ── Daily cache pre-warm ────────────────────────────────────────────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('Cron: Daily cache pre-warm starting');
    try {
      const summary = await warmCacheForTopAirports();
      logger.info('Cron: Cache pre-warm complete', summary);
    } catch (err) {
      logger.error('Cron: Cache pre-warm failed', { error: String(err) });
    }
  });

  // ── Half-hourly keep-alive ──────────────────────────────────────────────────
  // Hits getRouteChanges for the three biggest hubs every 30 minutes. The
  // intent is twofold:
  //   1. Keep the Railway container warm so cold-start (10-30s) never lands
  //      on a real reviewer / agent request.
  //   2. Re-warm the hottest cache entries if Redis evicts them under
  //      pressure (Railway's Redis tier can evict on memory pressure).
  // Cost: 3 × ~1.5s SQL every 30 min = 0.5% of one CPU core. Negligible.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const t0 = Date.now();
      // Lazy import to avoid pulling tool deps into the cron module graph.
      const { newRouteLaunches } = await import('../tools/routeLaunches');
      const { carrierCapacityRanking } = await import('../tools/marketLeaderboard');
      const hubs = ['ATL', 'ORD', 'JFK'];
      await Promise.all(
        hubs.flatMap((airport) => [
          newRouteLaunches({ airport }).catch(() => undefined),
          carrierCapacityRanking({ market: airport }).catch(() => undefined),
        ])
      );
      logger.info('Cron: 30-min keep-alive complete', {
        airports: hubs.length,
        elapsed_ms: Date.now() - t0,
      });
    } catch (err) {
      logger.warn('Cron: 30-min keep-alive failed', { error: String(err) });
    }
  });

  // Run an immediate pre-warm at boot so the first reviewer call hits a hot
  // cache rather than waiting for tomorrow's scheduled run.
  void warmCacheForTopAirports().then(
    (summary) => logger.info('Cron: Boot-time cache pre-warm complete', summary),
    (err) => logger.error('Cron: Boot-time cache pre-warm failed', { error: String(err) })
  );

  logger.info('Cron scheduler started', {
    jobs: [
      'weekly T-100 (Sun 02:00 UTC)',
      'daily cache pre-warm (07:00 UTC)',
      '30-min keep-alive (*/30 * * * *)',
    ],
  });
}
