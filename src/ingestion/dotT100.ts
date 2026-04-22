// ─────────────────────────────────────────────────────────────────────────────
// DOT/BTS T-100 Segment ingestion.
//
// Important context (current as of 2026):
//   BTS removed stable public URLs from /PREZIP in 2015. Current T-100 Segment
//   data is distributed exclusively through the BTS DL_SelectFields form at:
//     https://www.transtats.bts.gov/DL_SelectFields.asp?gnoyr_VQ=FIL
//                                   (&Table_ID=259 for T-100 Segment)
//   The form returns a ZIP with a random numeric prefix (e.g.
//   932989999_T_T100D_SEGMENT_US_CARRIER_ONLY.zip).
//
// This module therefore supports three ingestion paths — in priority order:
//
//   1. `--file <path>`     : a local CSV or ZIP file previously downloaded
//                            from BTS. This is the grant-review path.
//   2. `--url <https-url>` : a stable mirror URL you control (S3/R2/Railway
//                            volume / GitHub Release attachment). Cron reads
//                            the env var T100_DATA_URL with the same semantics.
//   3. No source available : ingester reports a clear error instructing the
//                            operator to run one of the above paths.
//
// In all three cases the raw CSV rows are aggregated into route_snapshots
// at MONTHLY granularity, then `recomputeRouteChanges()` rolls them up to
// quarterly aggregates for comparison.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { parse } from 'csv-parse';
import AdmZip from 'adm-zip';

import { NormalizedT100Row, T100Row } from '../types/index';
import { normalizeCarrierCode } from '../normalization/carrierCodes';
import { normalizeIata } from '../normalization/airportCodes';
import { normalizeAircraftCode, inferSeats } from '../normalization/aircraftTypes';
import {
  ensureAirports,
  ensureCarriers,
  upsertRouteSnapshot,
} from '../db/queries';
import { recomputeRouteChanges } from '../pipeline/recompute';
import { invalidatePattern } from '../cache/redis';
import { logger } from '../utils/logger';

// BTS column names vary slightly depending on how you fill the DL_SelectFields
// form. We map both the "All Carrier" and "US Carrier Only" Segment layouts.
const T100_COLUMN_ALIASES: Record<string, keyof T100Row> = {
  UNIQUE_CARRIER: 'CARRIER',
  CARRIER: 'CARRIER',
  OP_CARRIER: 'CARRIER',
  OPERATING_CARRIER: 'CARRIER',
  ORIGIN: 'ORIGIN',
  DEST: 'DEST',
  DESTINATION: 'DEST',
  DEST_AIRPORT: 'DEST',
  AIRCRAFT_TYPE: 'AIRCRAFT_TYPE',
  // NOTE: AIRCRAFT_CONFIG is a 1-digit enum (1=Pax, 2=Freight, 3=Combi,
  // 4=Seaplane) that BTS ships alongside AIRCRAFT_TYPE. Do NOT alias it to
  // AIRCRAFT_TYPE or it overwrites the real per-aircraft numeric code with a
  // useless passenger-vs-freight flag (seen in prod: 164k rows with value "1").
  // If we ever want passenger-only filtering we should add a dedicated
  // aircraft_config column to T100Row.
  DEPARTURES_SCHEDULED: 'DEPARTURES_SCHEDULED',
  DEPARTURES_PERFORMED: 'DEPARTURES_PERFORMED',
  SEATS: 'SEATS',
  PASSENGERS: 'PASSENGERS',
  FREIGHT: 'FREIGHT',
  DISTANCE: 'DISTANCE',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
};

function normalizeColumnName(raw: string): keyof T100Row | null {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, '_');
  return T100_COLUMN_ALIASES[upper] ?? null;
}

/**
 * Parse a CSV buffer or string into T100Row objects, normalizing column names.
 */
export async function parseT100Csv(
  source: string | Buffer | NodeJS.ReadableStream
): Promise<T100Row[]> {
  return new Promise((resolve, reject) => {
    const rows: T100Row[] = [];
    const parser = parse({
      columns: (header: string[]) =>
        header.map((h) => normalizeColumnName(h) ?? '__IGNORE__'),
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    });
    parser.on('readable', () => {
      let record: Record<string, string>;
      while ((record = parser.read() as Record<string, string>) !== null) {
        delete record['__IGNORE__'];
        rows.push(record as unknown as T100Row);
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));

    if (typeof source === 'string') {
      Readable.from([source]).pipe(parser);
    } else if (Buffer.isBuffer(source)) {
      Readable.from([source.toString('utf8')]).pipe(parser);
    } else {
      source.pipe(parser);
    }
  });
}

/**
 * Normalize a raw T100Row into a typed, cleaned NormalizedT100Row.
 * Returns null for unusable rows so the caller can count skips.
 */
export function normalizeT100Row(raw: T100Row): NormalizedT100Row | null {
  const carrier = normalizeCarrierCode(raw.CARRIER ?? '');
  const origin = normalizeIata(raw.ORIGIN ?? '');
  const dest = normalizeIata(raw.DEST ?? '');
  if (!origin || !dest || !carrier) return null;

  const year = parseInt(raw.YEAR, 10);
  const month = parseInt(raw.MONTH, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;

  const aircraft = normalizeAircraftCode(raw.AIRCRAFT_TYPE ?? 'UNK');
  const depsPerformed = parseInt(raw.DEPARTURES_PERFORMED ?? '0', 10) || 0;
  const seatsField = parseInt(raw.SEATS ?? '0', 10);
  // BTS SEATS is the product of flights × aircraft seats for the month.
  // Fall back to departures × typical-seats when the field is missing.
  const seats = seatsField > 0 ? seatsField : inferSeats(aircraft) * depsPerformed;

  return {
    carrier,
    origin,
    destination: dest,
    aircraft_type: aircraft,
    departures_scheduled: parseInt(raw.DEPARTURES_SCHEDULED ?? '0', 10) || 0,
    departures_performed: depsPerformed,
    seats,
    passengers: parseInt(raw.PASSENGERS ?? '0', 10) || 0,
    freight: parseFloat(raw.FREIGHT ?? '0') || 0,
    distance: parseFloat(raw.DISTANCE ?? '0') || 0,
    month,
    year,
    period: `${year}-${String(month).padStart(2, '0')}`,
  };
}

interface IngestSummary {
  ingested: number;
  skipped: number;
  months: string[];
}

/**
 * Ingest an array of raw T100 rows into the database at MONTHLY granularity,
 * then trigger a route-change recomputation.
 */
export async function ingestT100Rows(
  rows: T100Row[],
  sourceVintage: Date,
  opts: {
    recompute?: boolean;
    origin?: string;
    destination?: string;
    dryRun?: boolean;
  } = {}
): Promise<IngestSummary> {
  type AggKey = string;
  const agg = new Map<
    AggKey,
    {
      carrier: string;
      origin: string;
      destination: string;
      period: string;
      frequency: number;
      seats: number;
      aircraftMix: Record<string, number>;
    }
  >();

  const months = new Set<string>();
  let skipped = 0;
  for (const raw of rows) {
    const norm = normalizeT100Row(raw);
    if (!norm) {
      skipped++;
      continue;
    }
    if (opts.origin && norm.origin !== opts.origin.toUpperCase()) continue;
    if (opts.destination && norm.destination !== opts.destination.toUpperCase()) continue;

    months.add(norm.period);
    const key = `${norm.origin}:${norm.destination}:${norm.carrier}:${norm.period}`;
    const existing = agg.get(key) ?? {
      carrier: norm.carrier,
      origin: norm.origin,
      destination: norm.destination,
      period: norm.period,
      frequency: 0,
      seats: 0,
      aircraftMix: {},
    };
    existing.frequency += norm.departures_performed;
    existing.seats += norm.seats;
    existing.aircraftMix[norm.aircraft_type] =
      (existing.aircraftMix[norm.aircraft_type] ?? 0) + norm.departures_performed;
    agg.set(key, existing);
  }

  // Pre-register any airport/carrier codes seen in this batch that aren't in
  // the seeded reference tables yet. BTS T-100 includes long-tail regional
  // carriers and minor airports that would otherwise fail FK checks.
  if (!opts.dryRun) {
    const airportCodes = new Set<string>();
    const carrierCodes = new Set<string>();
    for (const snap of agg.values()) {
      airportCodes.add(snap.origin);
      airportCodes.add(snap.destination);
      carrierCodes.add(snap.carrier);
    }
    const insertedAirports = await ensureAirports([...airportCodes]);
    const insertedCarriers = await ensureCarriers([...carrierCodes]);
    if (insertedAirports > 0 || insertedCarriers > 0) {
      logger.info('Auto-registered reference codes not in seed data', {
        newAirports: insertedAirports,
        newCarriers: insertedCarriers,
      });
    }
  }

  let ingested = 0;
  let zeroActivity = 0;
  for (const snap of agg.values()) {
    // BTS T-100 is "reported" data: carriers file zeros for scheduled-but-unflown
    // segments. These aren't real operations — skip them so route_changes is clean.
    if (snap.frequency === 0 && snap.seats === 0) {
      zeroActivity++;
      continue;
    }
    if (opts.dryRun) {
      ingested++;
      continue;
    }
    try {
      await upsertRouteSnapshot({
        origin: snap.origin,
        destination: snap.destination,
        carrier: snap.carrier,
        period: snap.period,
        period_type: 'monthly',
        frequency: snap.frequency,
        inferred_seats: snap.seats,
        aircraft_type_mix: snap.aircraftMix,
        source: 'dot_t100',
        source_vintage: sourceVintage,
      });
      ingested++;
    } catch (err) {
      logger.warn('Failed to upsert snapshot', {
        route: `${snap.origin}-${snap.destination}`,
        carrier: snap.carrier,
        error: String(err),
      });
      skipped++;
    }
  }

  logger.info('T-100 snapshot ingestion complete', {
    ingested,
    skipped,
    zeroActivity,
    distinctMonths: months.size,
    dryRun: opts.dryRun ?? false,
  });

  if (!opts.dryRun && opts.recompute !== false) {
    const summary = await recomputeRouteChanges();
    logger.info('Post-ingest recompute complete', summary);
  } else if (!opts.dryRun) {
    await invalidatePattern('skypulse:*').catch(() => undefined);
  }

  return { ingested, skipped, months: [...months].sort() };
}

/**
 * Load bytes from a file path (CSV or ZIP).
 */
function readLocalFile(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

/**
 * Fetch bytes over HTTP(S) into memory. Returns a Buffer; errors on non-200.
 */
function fetchUrlToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      // Handle 30x redirects (BTS CDN sometimes redirects)
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const next = new URL(res.headers.location, url).toString();
        fetchUrlToBuffer(next).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode ?? 'unknown'} fetching ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Extract the first CSV from a ZIP buffer. Returns the CSV as a Buffer.
 * Handles the BTS "<random-prefix>_T_T100*_SEGMENT*.zip" layout.
 */
function extractCsvFromZip(zipBuffer: Buffer): Buffer {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const csvEntry = entries.find((e) =>
    /\.csv$/i.test(e.entryName) && !e.isDirectory
  );
  if (!csvEntry) {
    throw new Error(
      `ZIP archive contains no .csv file. Entries: ${entries
        .map((e) => e.entryName)
        .join(', ')}`
    );
  }
  return csvEntry.getData();
}

/**
 * Parse CSV/ZIP bytes into T100 rows (auto-detects format by magic bytes).
 */
export async function parseT100Bytes(buffer: Buffer): Promise<T100Row[]> {
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const csvBuffer = isZip ? extractCsvFromZip(buffer) : buffer;
  return parseT100Csv(csvBuffer);
}

export interface IngestSourceOptions {
  filePath?: string;
  url?: string;
  /** Directory of T-100 ZIP/CSV files to ingest sequentially. Recompute runs once at the end. */
  dirPath?: string;
  /** Vintage date to attribute to the ingested rows. Defaults to the latest month found in-data. */
  sourceVintage?: Date;
  origin?: string;
  destination?: string;
  recompute?: boolean;
  /** Parse + aggregate but do not touch the database. Useful for smoke-testing a BTS download. */
  dryRun?: boolean;
}

/**
 * Top-level ingestion entrypoint.
 * Exactly one of filePath or url must be provided (the module's __main__
 * block parses CLI args and the env var T100_DATA_URL for you).
 */
export async function ingestT100FromSource(
  opts: IngestSourceOptions
): Promise<IngestSummary> {
  if (opts.dirPath) {
    return ingestT100FromDirectory(opts);
  }
  if (!opts.filePath && !opts.url) {
    throw new Error(
      'ingestT100FromSource: pass filePath, url, dirPath, or set env T100_DATA_URL'
    );
  }

  logger.info('Starting T-100 ingestion', {
    filePath: opts.filePath,
    url: opts.url,
  });

  const buffer = opts.filePath
    ? readLocalFile(opts.filePath)
    : await fetchUrlToBuffer(opts.url as string);

  const rows = await parseT100Bytes(buffer);
  if (rows.length === 0) {
    throw new Error('T-100 source yielded zero rows — check the file format');
  }

  // Derive a default source_vintage from the latest YYYY-MM in the data.
  const vintage =
    opts.sourceVintage ?? latestMonthToDate(rows) ?? new Date();

  const summary = await ingestT100Rows(rows, vintage, {
    origin: opts.origin,
    destination: opts.destination,
    recompute: opts.recompute,
    dryRun: opts.dryRun,
  });

  logger.info('T-100 ingestion complete', {
    ingested: summary.ingested,
    skipped: summary.skipped,
    distinctMonths: summary.months.length,
    earliest: summary.months[0],
    latest: summary.months[summary.months.length - 1],
  });

  return summary;
}

/**
 * Walk a directory and ingest every T-100 ZIP or CSV inside.
 * Recompute is deferred until all files are ingested (runs once at the end).
 */
async function ingestT100FromDirectory(
  opts: IngestSourceOptions
): Promise<IngestSummary> {
  const dir = opts.dirPath as string;
  const entries = fs
    .readdirSync(dir)
    .filter((f) => /\.(zip|csv)$/i.test(f))
    .sort();
  if (entries.length === 0) {
    throw new Error(`No .zip or .csv files found in ${dir}`);
  }
  logger.info('Batch ingesting directory', { dir, files: entries.length });

  const totals: IngestSummary = { ingested: 0, skipped: 0, months: [] };
  const monthSet = new Set<string>();

  for (const [idx, file] of entries.entries()) {
    const full = path.join(dir, file);
    logger.info(`[${idx + 1}/${entries.length}] ingesting`, { file: full });
    try {
      const summary = await ingestT100FromSource({
        filePath: full,
        origin: opts.origin,
        destination: opts.destination,
        dryRun: opts.dryRun,
        // defer recompute to the end — it's expensive
        recompute: false,
      });
      totals.ingested += summary.ingested;
      totals.skipped += summary.skipped;
      summary.months.forEach((m) => monthSet.add(m));
    } catch (err) {
      logger.error('Failed to ingest file (continuing)', {
        file: full,
        error: String(err),
      });
      totals.skipped += 1;
    }
  }
  totals.months = [...monthSet].sort();

  logger.info('Directory batch ingest complete', {
    totalIngested: totals.ingested,
    totalSkipped: totals.skipped,
    distinctMonths: totals.months.length,
    monthRange: `${totals.months[0]} → ${totals.months[totals.months.length - 1]}`,
  });

  if (!opts.dryRun && opts.recompute !== false) {
    logger.info('Running recomputeRouteChanges over all ingested months…');
    const rc = await recomputeRouteChanges();
    logger.info('Post-batch recompute complete', rc);
  }

  return totals;
}

function latestMonthToDate(rows: T100Row[]): Date | null {
  let latest: Date | null = null;
  for (const r of rows) {
    const year = parseInt(r.YEAR, 10);
    const month = parseInt(r.MONTH, 10);
    if (!isNaN(year) && !isNaN(month)) {
      const d = new Date(Date.UTC(year, month - 1, 1));
      if (!latest || d > latest) latest = d;
    }
  }
  return latest;
}

/**
 * Parse argv for `--file <path>` / `--url <url>` / optional `--origin`/`--destination`.
 */
function parseCliArgs(argv: string[]): IngestSourceOptions {
  const opts: IngestSourceOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--file' && v) {
      opts.filePath = path.resolve(v);
      i++;
    } else if (k === '--dir' && v) {
      opts.dirPath = path.resolve(v);
      i++;
    } else if (k === '--url' && v) {
      opts.url = v;
      i++;
    } else if (k === '--origin' && v) {
      opts.origin = v.toUpperCase();
      i++;
    } else if (k === '--destination' && v) {
      opts.destination = v.toUpperCase();
      i++;
    } else if (k === '--no-recompute') {
      opts.recompute = false;
    } else if (k === '--dry-run') {
      opts.dryRun = true;
    }
  }
  if (!opts.filePath && !opts.url && process.env.T100_DATA_URL) {
    opts.url = process.env.T100_DATA_URL;
  }
  return opts;
}

// Standalone CLI: `npm run ingest:t100 -- --file ./data/t100.zip`
//                 `npm run ingest:t100 -- --dir  ./data/t100/`
if (require.main === module) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (!opts.filePath && !opts.url && !opts.dirPath) {
    logger.error(
      'No T-100 source supplied. Pass --file <path>, --dir <dir>, --url <url>, or set T100_DATA_URL. See README.'
    );
    process.exit(1);
  }
  ingestT100FromSource(opts)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Fatal ingestion error', { error: String(err) });
      process.exit(1);
    });
}

// ── Legacy re-export used by tests ───────────────────────────────────────────
export async function parseCsvString(csv: string): Promise<T100Row[]> {
  return parseT100Csv(csv);
}
