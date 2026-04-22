/**
 * FAA OPSNET / ASPM airport operations data ingestion.
 *
 * OPSNET (Operations Network) provides US airport operations counts.
 * ASPM (Aviation System Performance Metrics) provides more detailed
 * per-carrier, per-airport arrival/departure counts.
 *
 * Data available at: https://aspm.faa.gov/
 * Public download API: https://aspm.faa.gov/aspmhelp/index/ASPM_Airport_All.html
 *
 * NOTE: This module provides the scaffold for OPSNET/ASPM ingestion.
 * The FAA ASPM system requires registration for bulk downloads.
 * Public summary data is available via the FAA OPSNET system.
 */

import { upsertRouteSnapshot } from '../db/queries';
import { normalizeIata } from '../normalization/airportCodes';
import { logger } from '../utils/logger';

export interface OpsnetRow {
  airport: string;
  year: number;
  month: number;
  total_ops: number;
  ifo_ops: number;       // IFR flight operations
  vfr_ops: number;       // VFR operations
  carrier_ops: number;   // Air carrier operations
  commuter_ops: number;  // Air taxi/commuter operations
}

/**
 * Parse a raw OPSNET CSV row into a typed OpsnetRow.
 * The FAA OPSNET CSV format has columns: AIRPORT, YEAR, MONTH, TOTAL, IFO, VFR, CARRIER, COMMUTER
 */
export function parseOpsnetRow(
  raw: Record<string, string>
): OpsnetRow | null {
  const airport = normalizeIata(raw['AIRPORT'] ?? '');
  if (!airport) return null;

  const year = parseInt(raw['YEAR'] ?? '', 10);
  const month = parseInt(raw['MONTH'] ?? '', 10);
  if (isNaN(year) || isNaN(month)) return null;

  return {
    airport,
    year,
    month,
    total_ops: parseInt(raw['TOTAL'] ?? '0', 10) || 0,
    ifo_ops: parseInt(raw['IFO'] ?? '0', 10) || 0,
    vfr_ops: parseInt(raw['VFR'] ?? '0', 10) || 0,
    carrier_ops: parseInt(raw['CARRIER'] ?? '0', 10) || 0,
    commuter_ops: parseInt(raw['COMMUTER'] ?? '0', 10) || 0,
  };
}

/**
 * Ingest OPSNET operations data as a supplementary source.
 * OPSNET data does not have route-level detail, so it is recorded as
 * airport-level snapshots rather than O&D pairs.
 *
 * In the current implementation, OPSNET data is ingested into a
 * summary format that can be used to validate T-100 frequency counts.
 */
export async function ingestOpsnetRows(
  rows: OpsnetRow[],
  sourceVintage: Date
): Promise<{ ingested: number; skipped: number }> {
  let ingested = 0;
  let skipped = 0;

  for (const row of rows) {
    // OPSNET provides airport totals, not O&D pairs.
    // We store a self-referential snapshot as a marker.
    try {
      await upsertRouteSnapshot({
        origin: row.airport,
        destination: row.airport,  // self-referential marker
        carrier: 'ZZ',             // synthetic "all carriers" code
        period: `${row.year}-${String(row.month).padStart(2, '0')}`,
        period_type: 'monthly',
        frequency: row.carrier_ops,
        inferred_seats: null,
        aircraft_type_mix: null,
        source: 'faa_opsnet',
        source_vintage: sourceVintage,
      });
      ingested++;
    } catch (err) {
      logger.warn('Failed to ingest OPSNET row', {
        airport: row.airport,
        error: String(err),
      });
      skipped++;
    }
  }

  logger.info('OPSNET ingestion complete', { ingested, skipped });
  return { ingested, skipped };
}

/**
 * Fetch OPSNET data for a given year from the FAA OPSNET system.
 * This is a placeholder implementation - actual BTS/FAA data access
 * requires registration and uses specific download endpoints.
 */
export async function fetchOpsnetForYear(year: number): Promise<void> {
  logger.info(`OPSNET ingestion for year ${year} - requires FAA ASPM registration`);
  logger.info('Please download OPSNET data manually from https://aspm.faa.gov/ and use ingestOpsnetRows()');
}
