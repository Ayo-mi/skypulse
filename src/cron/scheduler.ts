import cron from 'node-cron';
import { logger } from '../utils/logger';
import { ingestT100FromSource } from '../ingestion/dotT100';
import { recomputeRouteChanges } from '../pipeline/recompute';
import { invalidatePattern } from '../cache/redis';

/**
 * Cron job schedule:
 *
 *  - Weekly (Sunday 02:00 UTC) : Re-ingest T-100 from T100_DATA_URL mirror, then
 *                                recompute route_changes and flush cache.
 *  - Daily  (06:00 UTC)        : Pull announcement feed (if ANNOUNCEMENT_FEED_URL
 *                                is set) and recompute so corroboration lands in
 *                                route_changes.source_refs.
 *
 * Both jobs are only installed when RUN_CRON=true, controlled by src/index.ts.
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

  // ── Daily announcement scan ─────────────────────────────────────────────────
  cron.schedule('0 6 * * *', async () => {
    logger.info('Cron: Daily announcement scan starting');
    try {
      const feedUrl = process.env.ANNOUNCEMENT_FEED_URL;
      if (!feedUrl) {
        logger.info('Cron: ANNOUNCEMENT_FEED_URL not configured, skipping');
        return;
      }
      const { fetchAnnouncementFeed, insertAnnouncement } = await import(
        '../ingestion/announcements'
      );
      const records = await fetchAnnouncementFeed(feedUrl);
      for (const record of records) {
        await insertAnnouncement(record);
      }
      logger.info(`Cron: Ingested ${records.length} announcements`);
      if (records.length > 0) {
        await recomputeRouteChanges();
      }
      await invalidatePattern('skypulse:*');
    } catch (err) {
      logger.error('Cron: Announcement scan failed', { error: String(err) });
    }
  });

  logger.info('Cron scheduler started', {
    jobs: ['weekly T-100 (Sun 02:00 UTC)', 'daily announcements (06:00 UTC)'],
  });
}
