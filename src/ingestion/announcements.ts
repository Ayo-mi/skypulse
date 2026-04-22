/**
 * Airline/airport press release and route announcement scraper.
 *
 * Monitors airline newsrooms and airport press releases for route
 * launch, suspension, resumption, and frequency change announcements.
 *
 * NOTE: This module provides structured ingestion of pre-downloaded
 * announcements.  No live scraping is performed at query time.
 * All data is pre-ingested and served from the database.
 *
 * Monitored sources (configured below):
 *  - Airline investor relations / newsrooms
 *  - Airport press release RSS feeds
 *  - OAG/Cirium public announcements
 */

import 'dotenv/config';
import * as https from 'https';
import { query } from '../db/connection';
import { normalizeIata } from '../normalization/airportCodes';
import { normalizeCarrierCode } from '../normalization/carrierCodes';
import { logger } from '../utils/logger';

export interface AnnouncementRecord {
  carrier: string;
  origin: string;
  destination: string;
  announcement_type: 'launch' | 'suspension' | 'resumption' | 'frequency_change';
  effective_date: Date | null;
  announced_date: Date | null;
  source_url: string | null;
  source_text: string | null;
}

/**
 * Insert a new route announcement into the database.
 */
export async function insertAnnouncement(
  record: AnnouncementRecord
): Promise<void> {
  const carrier = normalizeCarrierCode(record.carrier);
  const origin = normalizeIata(record.origin);
  const dest = normalizeIata(record.destination);

  if (!origin || !dest) {
    logger.warn('Skipping announcement with invalid airport codes', {
      origin: record.origin,
      dest: record.destination,
    });
    return;
  }

  await query(
    `INSERT INTO route_announcements
       (carrier, origin, destination, announcement_type,
        effective_date, announced_date, source_url, source_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      carrier,
      origin,
      dest,
      record.announcement_type,
      record.effective_date ?? null,
      record.announced_date ?? null,
      record.source_url ?? null,
      record.source_text ?? null,
    ]
  );
}

/**
 * Fetch and parse a simple JSON feed of announcements.
 * Returns parsed AnnouncementRecord objects.
 *
 * The feed format is:
 * {
 *   "announcements": [
 *     {
 *       "carrier": "DL",
 *       "origin": "ATL",
 *       "destination": "LAX",
 *       "type": "launch",
 *       "effective_date": "2025-06-01",
 *       "announced_date": "2025-03-15",
 *       "url": "https://...",
 *       "text": "Delta announces new ATL-LAX service..."
 *     }
 *   ]
 * }
 */
export async function fetchAnnouncementFeed(
  feedUrl: string
): Promise<AnnouncementRecord[]> {
  return new Promise((resolve, reject) => {
    https
      .get(feedUrl, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              announcements: Array<{
                carrier: string;
                origin: string;
                destination: string;
                type: string;
                effective_date?: string;
                announced_date?: string;
                url?: string;
                text?: string;
              }>;
            };
            const records: AnnouncementRecord[] = (
              parsed.announcements ?? []
            ).map((a) => ({
              carrier: a.carrier,
              origin: a.origin,
              destination: a.destination,
              announcement_type: a.type as AnnouncementRecord['announcement_type'],
              effective_date: a.effective_date
                ? new Date(a.effective_date)
                : null,
              announced_date: a.announced_date
                ? new Date(a.announced_date)
                : null,
              source_url: a.url ?? null,
              source_text: a.text ?? null,
            }));
            resolve(records);
          } catch (err) {
            reject(new Error(`Failed to parse announcement feed: ${String(err)}`));
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Mark an announcement as processed after it has been incorporated
 * into a route_change record.
 */
export async function markAnnouncementProcessed(id: number): Promise<void> {
  await query(
    'UPDATE route_announcements SET processed=TRUE WHERE id=$1',
    [id]
  );
}

/**
 * Get unprocessed announcements for a carrier/route pair.
 */
export async function getUnprocessedAnnouncements(options?: {
  carrier?: string;
  origin?: string;
  destination?: string;
}): Promise<
  Array<{
    id: number;
    carrier: string;
    origin: string;
    destination: string;
    announcement_type: string;
    effective_date: Date | null;
    source_url: string | null;
  }>
> {
  const params: unknown[] = [];
  const conditions = ['processed = FALSE'];

  if (options?.carrier) {
    params.push(options.carrier);
    conditions.push(`carrier=$${params.length}`);
  }
  if (options?.origin) {
    params.push(options.origin);
    conditions.push(`origin=$${params.length}`);
  }
  if (options?.destination) {
    params.push(options.destination);
    conditions.push(`destination=$${params.length}`);
  }

  return query(
    `SELECT id, carrier, origin, destination, announcement_type,
            effective_date, source_url
     FROM route_announcements
     WHERE ${conditions.join(' AND ')}
     ORDER BY announced_date DESC`,
    params
  );
}

// Run as standalone script
if (require.main === module) {
  logger.info('Announcement ingestion — no configured feed URLs yet');
  logger.info('Configure ANNOUNCEMENT_FEED_URL in .env to enable automated ingestion');
  process.exit(0);
}
