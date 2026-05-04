// ─────────────────────────────────────────────────────────────────────────────
// JSON schema validation tests.
//
// These tests exercise every published outputSchema against a realistic
// fixture that mirrors what the real tool handler produces. If a tool's
// handler ever returns a shape that the outputSchema doesn't describe, this
// test fails — protecting us from the exact class of bug that burns Context
// tool reviewers (missing `carrier_name`, snake_case vs camelCase drift, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

import {
  ROUTE_CAPACITY_CHANGE_INPUT_SCHEMA,
  ROUTE_CAPACITY_CHANGE_OUTPUT_SCHEMA,
  NEW_ROUTE_LAUNCHES_INPUT_SCHEMA,
  NEW_ROUTE_LAUNCHES_OUTPUT_SCHEMA,
  FREQUENCY_LOSERS_INPUT_SCHEMA,
  FREQUENCY_LOSERS_OUTPUT_SCHEMA,
  CAPACITY_DRIVER_ANALYSIS_INPUT_SCHEMA,
  CAPACITY_DRIVER_ANALYSIS_OUTPUT_SCHEMA,
  CARRIER_CAPACITY_RANKING_INPUT_SCHEMA,
  CARRIER_CAPACITY_RANKING_OUTPUT_SCHEMA,
  ERROR_OUTPUT_SCHEMA,
} from '../src/tools/schemas';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function prettyErrors(errors: ErrorObject[] | null | undefined): string {
  return JSON.stringify(errors ?? [], null, 2);
}

describe('route_capacity_change', () => {
  const validateIn = ajv.compile(ROUTE_CAPACITY_CHANGE_INPUT_SCHEMA);
  const validateOut = ajv.compile(ROUTE_CAPACITY_CHANGE_OUTPUT_SCHEMA);

  it('accepts valid input', () => {
    expect(validateIn({ origin: 'JFK', destination: 'LAX' })).toBe(true);
    expect(validateIn({ origin: 'JFK', destination: 'LAX', days_back: 365 })).toBe(
      true
    );
  });

  it('rejects invalid input', () => {
    expect(validateIn({ origin: 'JF', destination: 'LAX' })).toBe(false);
    expect(validateIn({ origin: 'JFK' })).toBe(false);
    expect(validateIn({ origin: 'JFK', destination: 'LAX', extra: 1 })).toBe(false);
  });

  it('accepts a realistic response', () => {
    const resp = {
      origin: 'JFK',
      destination: 'LAX',
      changes: [
        {
          carrier: 'AA',
          carrier_name: 'American Airlines',
          comparison_period: '2025-Q3 vs 2025-Q2',
          change_type: 'growth',
          prior_frequency: 120,
          current_frequency: 140,
          frequency_change_abs: 20,
          frequency_change_pct: 16.67,
          prior_inferred_seats: 22680,
          current_inferred_seats: 26460,
          capacity_change_abs: 3780,
          capacity_change_pct: 16.67,
          aircraft_type_mix_prior: { B738: 120 },
          aircraft_type_mix_current: { B738: 140 },
          confidence: 0.82,
          known_unknowns: null,
          source_refs: [{ source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' }],
        },
      ],
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: '2025-Q3 vs 2025-Q2',
      source_refs: [{ source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' }],
      confidence: 0.82,
      known_unknowns: 'None identified',
      data_freshness:
        'Source: DOT T-100 2025-Q3 (published Jan 2026) + Press Releases through Mar 2026 — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error('validation failed: ' + prettyErrors(validateOut.errors));
    expect(ok).toBe(true);
  });

  it('accepts an empty-result response', () => {
    const resp = {
      origin: 'JFK',
      destination: 'XXX',
      changes: [],
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: 'N/A',
      source_refs: [],
      confidence: 0,
      known_unknowns: 'No data found',
      data_freshness:
        'Source: DOT T-100 (no ingested data in scope) + Press Releases (none ingested in scope) — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error('validation failed: ' + prettyErrors(validateOut.errors));
  });

  it('rejects drifted camelCase properties', () => {
    const resp = {
      origin: 'JFK',
      destination: 'LAX',
      changes: [],
      asOf: '2026-04-22T00:00:00.000Z', // wrong: should be as_of
      comparison_period: 'N/A',
      source_refs: [],
      confidence: 0,
      known_unknowns: 'No data',
      data_freshness: 'x',
    };
    expect(validateOut(resp)).toBe(false);
  });
});

describe('new_route_launches', () => {
  const validateOut = ajv.compile(NEW_ROUTE_LAUNCHES_OUTPUT_SCHEMA);
  const validateIn = ajv.compile(NEW_ROUTE_LAUNCHES_INPUT_SCHEMA);

  it('validates input', () => {
    expect(validateIn({ airport: 'ORD' })).toBe(true);
    expect(validateIn({ airport: 'ORD', period: '2025-Q3' })).toBe(true);
    expect(validateIn({ airport: 'or' })).toBe(false);
  });

  it('validates a response with routes', () => {
    const resp = {
      airport: 'ORD',
      period: '2025-Q3',
      routes: [
        {
          carrier: 'UA',
          carrier_name: 'United Airlines',
          origin: 'ORD',
          destination: 'MUC',
          change_type: 'first_observed_in_dataset',
          comparison_period: '2025-Q3 (first_observed)',
          current_frequency: 90,
          current_inferred_seats: 21600,
          effective_date: '2025-08-15T00:00:00.000Z',
          confidence: 0.75,
          source_refs: [
            { source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' },
            { source: 'Press Release', vintage: 'corroborated (+/- 45d)' },
          ],
        },
      ],
      total_available: 1,
      limit_applied: 30,
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: '2025-Q3 (first_observed)',
      source_refs: [{ source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' }],
      confidence: 0.75,
      known_unknowns: 'None identified',
      data_freshness: 'Source: DOT T-100 2025-Q3 (published Jan 2026) + Press Releases through Mar 2026 — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error(prettyErrors(validateOut.errors));
  });
});

describe('frequency_losers', () => {
  const validateOut = ajv.compile(FREQUENCY_LOSERS_OUTPUT_SCHEMA);
  const validateIn = ajv.compile(FREQUENCY_LOSERS_INPUT_SCHEMA);

  it('accepts empty input', () => {
    expect(validateIn({})).toBe(true);
    expect(validateIn({ market: 'ATL' })).toBe(true);
  });

  it('validates a response', () => {
    const resp = {
      market: 'ATL',
      period: null,
      losers: [
        {
          origin: 'ATL',
          destination: 'BWI',
          carrier: 'DL',
          carrier_name: 'Delta Air Lines',
          comparison_period: '2025-Q3 vs 2025-Q2',
          frequency_change_pct: -25.5,
          frequency_change_abs: -30,
          prior_frequency: 118,
          current_frequency: 88,
          confidence: 0.7,
        },
      ],
      total_available: 1,
      limit_applied: 30,
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: '2025-Q3 vs 2025-Q2',
      source_refs: [{ source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' }],
      confidence: 0.7,
      known_unknowns: 'None identified',
      data_freshness: 'Source: DOT T-100 2025-Q3 (published Jan 2026) + Press Releases through Mar 2026 — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error(prettyErrors(validateOut.errors));
  });
});

describe('capacity_driver_analysis', () => {
  const validateOut = ajv.compile(CAPACITY_DRIVER_ANALYSIS_OUTPUT_SCHEMA);
  const validateIn = ajv.compile(CAPACITY_DRIVER_ANALYSIS_INPUT_SCHEMA);

  it('validates input', () => {
    expect(validateIn({ origin: 'SFO', destination: 'ORD' })).toBe(true);
    expect(validateIn({ origin: 'SFO', destination: 'ORD', carrier: 'UA' })).toBe(true);
    expect(validateIn({ origin: 'SFO', destination: 'ORD', carrier: 'U' })).toBe(false);
  });

  it('validates a response', () => {
    const resp = {
      origin: 'SFO',
      destination: 'ORD',
      carrier: null,
      analysis: [
        {
          carrier: 'UA',
          carrier_name: 'United Airlines',
          comparison_period: '2025-Q3 vs 2025-Q2',
          driver: 'gauge_driven',
          frequency_change_pct: 2.1,
          capacity_change_pct: 15.4,
          aircraft_type_mix_prior: { B738: 80 },
          aircraft_type_mix_current: { B738: 40, B789: 40 },
          confidence: 0.8,
          known_unknowns: null,
        },
      ],
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: '2025-Q3 vs 2025-Q2',
      source_refs: [{ source: 'DOT T-100', vintage: 'Q3 2025 (published Jan 2026)' }],
      confidence: 0.8,
      known_unknowns: 'None identified',
      data_freshness: 'Source: DOT T-100 2025-Q3 (published Jan 2026) + Press Releases through Mar 2026 — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error(prettyErrors(validateOut.errors));
  });
});

describe('carrier_capacity_ranking', () => {
  const validateOut = ajv.compile(CARRIER_CAPACITY_RANKING_OUTPUT_SCHEMA);
  const validateIn = ajv.compile(CARRIER_CAPACITY_RANKING_INPUT_SCHEMA);

  it('validates input', () => {
    expect(validateIn({ market: 'DFW' })).toBe(true);
    expect(validateIn({ market: 'DFW', aircraft_category: 'narrowbody' })).toBe(true);
    expect(validateIn({ market: 'DFW', aircraft_category: 'invalid' })).toBe(false);
  });

  it('validates a response', () => {
    const resp = {
      market: 'DFW',
      aircraft_category: 'narrowbody',
      period: '2025-Q3',
      ranking: [
        {
          rank: 1,
          carrier: 'AA',
          carrier_name: 'American Airlines',
          total_capacity_change_abs: 12500,
          total_capacity_change_pct: 4.5,
          total_capacity_added_seats: 14200,
          total_current_seats: 290000,
          total_prior_seats: 277500,
          routes_gained: 8,
          routes_lost: 3,
          routes_unchanged: 42,
          top_routes: [
            {
              origin: 'DFW',
              destination: 'LGA',
              capacity_change_abs: 5400,
              change_type: 'gauge_up',
              comparison_period: '2025-Q3 vs 2025-Q2',
            },
            {
              origin: 'DFW',
              destination: 'BOS',
              capacity_change_abs: 3600,
              change_type: 'growth',
              comparison_period: '2025-Q3 vs 2025-Q2',
            },
          ],
        },
      ],
      as_of: '2026-04-22T00:00:00.000Z',
      comparison_period: '2025-Q3',
      source_refs: [{ source: 'DOT T-100', vintage: '2025-Q3' }],
      confidence: 0.75,
      known_unknowns: 'Codeshare allocation not fully attributed.',
      data_freshness: 'Source: DOT T-100 2025-Q3 (published Jan 2026) + Press Releases through Mar 2026 — as of 2026-04-22T00:00:00.000Z',
    };
    const ok = validateOut(resp);
    if (!ok) throw new Error(prettyErrors(validateOut.errors));
  });
});

describe('error response', () => {
  const validateErr = ajv.compile(ERROR_OUTPUT_SCHEMA);
  it('validates an error envelope', () => {
    expect(validateErr({ error: 'INVALID_INPUT', message: 'bad' })).toBe(true);
    expect(validateErr({ error: 'X', message: 'm', details: { k: 'v' } })).toBe(true);
    expect(validateErr({ error: 'X' })).toBe(false);
  });
});
