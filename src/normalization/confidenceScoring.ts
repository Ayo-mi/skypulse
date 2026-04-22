import { ChangeType, SourceRef } from '../types/index';

interface ConfidenceInput {
  changeType: ChangeType;
  sourceRefs: SourceRef[];
  hasAnnouncementCorroboration?: boolean;
  dataAge_days?: number;
  hasAircraftMixData?: boolean;
}

/**
 * Compute a confidence score (0–1) based on available evidence quality.
 *
 * Factors:
 *  - Multi-source corroboration boosts confidence
 *  - Announcement corroboration boosts confidence
 *  - Stale data reduces confidence
 *  - Missing aircraft mix data reduces confidence for gauge changes
 */
export function computeConfidence(input: ConfidenceInput): number {
  let score = 0.5; // base

  // Multiple sources
  if (input.sourceRefs.length > 1) score += 0.15;

  // Announcement corroboration
  if (input.hasAnnouncementCorroboration) score += 0.2;

  // Data freshness
  if (input.dataAge_days !== undefined) {
    if (input.dataAge_days <= 90) {
      score += 0.1;
    } else if (input.dataAge_days > 365) {
      score -= 0.1;
    }
  }

  // Aircraft mix data
  if (input.hasAircraftMixData) {
    score += 0.05;
  } else if (
    input.changeType === 'gauge_up' ||
    input.changeType === 'gauge_down'
  ) {
    // gauge changes without mix data are less reliable
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * Build the known_unknowns string based on what data is missing.
 */
export function buildKnownUnknowns(options: {
  hasMixData: boolean;
  hasAnnouncementData: boolean;
  sourceCount: number;
  dataAge_days?: number;
}): string {
  const gaps: string[] = [];

  if (!options.hasMixData) {
    gaps.push('Aircraft type mix not available for this route/period');
  }
  if (!options.hasAnnouncementData) {
    gaps.push('No press release corroboration found');
  }
  if (options.sourceCount < 2) {
    gaps.push('Single data source only — cross-validation not possible');
  }
  if (options.dataAge_days !== undefined && options.dataAge_days > 180) {
    gaps.push(
      `Data is ${Math.round(options.dataAge_days / 30)} months old — recent changes may not be reflected`
    );
  }

  return gaps.length > 0 ? gaps.join('. ') : 'None identified';
}
