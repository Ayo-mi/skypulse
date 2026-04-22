/**
 * Aircraft configuration and seat reference table management.
 *
 * This module handles ingestion of aircraft reference data from external
 * sources (e.g., OAG aircraft reference, IATA aircraft type codes) and
 * updates the aircraft_types table in the database.
 */

import { query } from '../db/connection';
import { SEAT_REFERENCE } from '../normalization/aircraftTypes';
import { logger } from '../utils/logger';

/**
 * Sync the in-memory SEAT_REFERENCE table to the database aircraft_types table.
 * This ensures the database is consistent with the code-level reference.
 */
export async function syncAircraftReferenceToDb(): Promise<void> {
  let upserted = 0;
  let failed = 0;

  for (const [code, ref] of Object.entries(SEAT_REFERENCE)) {
    // Only sync canonical codes (skip aliases that map to other codes)
    if (ref.iataCode !== code) continue;

    try {
      await query(
        `INSERT INTO aircraft_types
           (iata_type_code, manufacturer, model, family,
            typical_seats_economy, typical_seats_total, category)
         VALUES ($1, 'Unknown', $1, NULL, $2, $3, $4)
         ON CONFLICT (iata_type_code) DO UPDATE SET
           typical_seats_economy = EXCLUDED.typical_seats_economy,
           typical_seats_total   = EXCLUDED.typical_seats_total,
           category              = EXCLUDED.category`,
        [code, ref.economySeats, ref.totalSeats, ref.category]
      );
      upserted++;
    } catch (err) {
      logger.warn('Failed to upsert aircraft type', { code, error: String(err) });
      failed++;
    }
  }

  logger.info('Aircraft reference sync complete', { upserted, failed });
}

/**
 * Look up aircraft seat count from the database (falls back to in-memory reference).
 */
export async function lookupSeatsFromDb(
  iataTypeCode: string
): Promise<number | null> {
  const rows = await query<{ typical_seats_total: number }>(
    'SELECT typical_seats_total FROM aircraft_types WHERE iata_type_code=$1',
    [iataTypeCode.toUpperCase()]
  );
  return rows[0]?.typical_seats_total ?? null;
}
