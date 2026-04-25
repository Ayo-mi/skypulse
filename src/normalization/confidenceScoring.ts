import { ChangeType, SourceRef } from '../types/index';

interface ConfidenceInput {
  changeType: ChangeType;
  sourceRefs: SourceRef[];
  /** @deprecated Press-release corroboration removed from product scope. */
  hasAnnouncementCorroboration?: boolean;
  dataAge_days?: number;
  hasAircraftMixData?: boolean;
}

/**
 * Compute a confidence score (0–1) based on available evidence quality.
 *
 * Scoring is deliberately calibrated for a BTS-only historical pipeline:
 *  - first_observed_in_dataset / re_observed_after_gap rows are capped at 0.6
 *    because we cannot prove they reflect a true marketing launch (vs. just
 *    the earliest BTS quarter we have data for).
 *  - growth/reduction rows benefit from in-period aircraft mix data and
 *    fresh vintage; without those, score floors at 0.5.
 */
export function computeConfidence(input: ConfidenceInput): number {
  let score = 0.5; // base

  // Multiple sources
  if (input.sourceRefs.length > 1) score += 0.15;

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

  // BTS-only "observation" rows can't claim more than mid-confidence: we have
  // no schedule-source or press-release corroboration that the route
  // genuinely launched in the indicated quarter. Cap explicitly.
  if (
    input.changeType === 'first_observed_in_dataset' ||
    input.changeType === 're_observed_after_gap'
  ) {
    score = Math.min(score, 0.6);
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * Build the known_unknowns string based on what data is missing.
 */
export function buildKnownUnknowns(options: {
  hasMixData: boolean;
  /** @deprecated Press-release layer removed from product scope. */
  hasAnnouncementData?: boolean;
  sourceCount: number;
  dataAge_days?: number;
}): string {
  const gaps: string[] = [];

  if (!options.hasMixData) {
    gaps.push('Aircraft type mix not available for this route/period');
  }
  if (options.sourceCount < 2) {
    gaps.push('Single data source (BTS T-100 only) — no schedule-source or press-release corroboration available');
  }
  if (options.dataAge_days !== undefined && options.dataAge_days > 180) {
    gaps.push(
      `Data is ~${Math.round(options.dataAge_days / 30)} months old (BTS T-100 has a 3-6 month publication lag) — recent changes may not yet be reflected`
    );
  }

  return gaps.length > 0 ? gaps.join('. ') : 'None identified';
}
