import { FreshnessMetadata, SourceRef } from '../types/index';

/**
 * Builds the standard freshness metadata block that every tool response must include.
 *
 * `data_freshness` follows the Context Protocol-visible format:
 *   "Source: BTS T-100 vintage <month year> (period <quarter>) + Press Releases through <month year> — as of <iso timestamp>"
 *
 * When the tool cannot determine a source vintage (no rows in scope) it falls
 * back to a clearly-labeled "vintage unknown" string so reviewers can't mis-
 * interpret stale responses as fresh.
 */
export function buildFreshnessMetadata(options: {
  as_of?: Date;
  comparison_period: string;
  source_refs: SourceRef[];
  confidence: number;
  known_unknowns: string;
  latestDataVintage?: Date | null;
  latestAnnouncementDate?: Date | null;
}): FreshnessMetadata {
  const as_of = options.as_of ?? new Date();
  const t100Label = options.latestDataVintage
    ? formatT100Label(options.latestDataVintage)
    : 'BTS T-100 (no ingested data in scope)';
  const prLabel = options.latestAnnouncementDate
    ? `Press Releases through ${monthYear(options.latestAnnouncementDate)}`
    : 'Press Releases (none ingested in scope)';
  return {
    as_of: as_of.toISOString(),
    comparison_period: options.comparison_period,
    source_refs: dedupeSourceRefs(options.source_refs),
    confidence: options.confidence,
    known_unknowns: options.known_unknowns,
    data_freshness: `Source: ${t100Label} + ${prLabel} — as of ${as_of.toISOString()}`,
  };
}

/**
 * Label format: "BTS T-100 vintage Jan 2026 (period 2026-Q1)".
 *
 * Previously we computed a speculative `published <monthYear>` by adding a
 * 5-month lag to the vintage, but this produced publication dates in the
 * future when the vintage itself was recent — e.g. vintage Jan 2026 published
 * Jun 2026 was displayed on Apr 22 2026. The vintage month is both factual
 * and sufficient for downstream agents to reason about data age.
 */
function formatT100Label(vintage: Date): string {
  const year = vintage.getUTCFullYear();
  const quarter = Math.ceil((vintage.getUTCMonth() + 1) / 3);
  return `BTS T-100 vintage ${monthYear(vintage)} (period ${year}-Q${quarter})`;
}

function monthYear(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dedupeSourceRefs(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    const key = `${r.source}|${r.vintage}|${r.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Returns a period label like "2025-Q3" from a Date.
 */
export function dateToPeriodLabel(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

/**
 * Returns a comparison string like "2025-Q3 vs 2025-Q2".
 */
export function buildComparisonPeriod(current: string, prior: string): string {
  return `${current} vs ${prior}`;
}
