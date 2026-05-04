// ─────────────────────────────────────────────────────────────────────────────
// JSON Schemas for every tool's input and output.
//
// These schemas serve three roles for the Context Protocol:
//   1. Tool discovery: listed to every agent that calls `tools/list`.
//   2. Runtime validation: the platform uses outputSchema to plan retries,
//      synthesize answers, and adjudicate disputes. Every response property
//      must appear here with the exact name the server actually returns.
//   3. Client-side Ajv validation in our own test harness.
//
// Property naming stays snake_case end-to-end to match the stored schema and
// the grant proposal's published evidence fields.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_REF_SCHEMA = {
  type: 'object',
  description: 'One provenance reference backing the answer.',
  properties: {
    source: { type: 'string', description: 'Human-readable source label (e.g. "DOT T-100")' },
    vintage: { type: 'string', description: 'Source vintage (e.g. "Q3 2025 (published Jan 2026)")' },
    url: { type: 'string', format: 'uri', description: 'Optional link to the raw source.' },
  },
  required: ['source', 'vintage'],
  additionalProperties: false,
} as const;

const FRESHNESS_PROPERTIES = {
  as_of: {
    type: 'string',
    format: 'date-time',
    description: 'ISO 8601 timestamp when the response was computed.',
  },
  comparison_period: {
    type: 'string',
    description:
      'Time windows being compared, e.g. "2025-Q3 vs 2025-Q2". "N/A" when no data was found.',
  },
  source_refs: {
    type: 'array',
    description: 'Every source that contributed evidence to this response.',
    items: SOURCE_REF_SCHEMA,
  },
  confidence: {
    type: 'number',
    minimum: 0,
    maximum: 1,
    description: 'Aggregate confidence score for the response (0–1).',
  },
  known_unknowns: {
    type: 'string',
    description:
      'Explicit, human-readable description of any data gaps, lag, or uncertainty. "None identified" if clean.',
  },
  data_freshness: {
    type: 'string',
    description:
      'Explicit freshness label in the form "Source: BTS T-100 Segment vintage <month year> (period <quarter>), 3-6 month BTS publication lag — as of <iso timestamp>".',
  },
} as const;

const CARRIER_NAME_SCHEMA = {
  type: 'string',
  description:
    'Human-readable carrier name. Returns "Unresolved (BTS code: <X>)" when the BTS UNIQUE_CARRIER code did not map to a known operator (typically charter, small cargo, or BTS-internal sub-regional codes); see is_unresolved.',
} as const;

const IS_UNRESOLVED_SCHEMA = {
  type: 'boolean',
  description:
    'True when the BTS carrier code did NOT resolve to a known operator after IATA / DOT-numeric / ICAO normalization. Use to filter out data-quality outliers or to surface them to end users.',
} as const;

// IMPORTANT: SkyPulse is BTS-only — we cannot distinguish a true marketing
// launch from "first quarter the dataset covers". The enum names reflect
// dataset semantics, not real-world claims. See `src/types/index.ts` for
// the full vocabulary contract.
const CHANGE_TYPE_ENUM = [
  'first_observed_in_dataset',
  'suspension',
  're_observed_after_gap',
  'growth',
  'reduction',
  'gauge_up',
  'gauge_down',
] as const;

const AIRCRAFT_MIX_SCHEMA = {
  type: ['object', 'null'],
  description:
    'Aircraft type → frequency (departures) mix for the period. Keys are IATA aircraft type codes (e.g. "B738"), values are integer departure counts.',
  additionalProperties: { type: 'integer', minimum: 0 },
} as const;

// ── route_capacity_change ────────────────────────────────────────────────────

export const ROUTE_CAPACITY_CHANGE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    origin: {
      type: 'string',
      description: 'IATA origin airport code (3 uppercase letters).',
      minLength: 3,
      maxLength: 3,
      examples: ['JFK', 'ATL', 'DFW'],
    },
    destination: {
      type: 'string',
      description: 'IATA destination airport code (3 uppercase letters).',
      minLength: 3,
      maxLength: 3,
      examples: ['LAX', 'LHR', 'ORD'],
    },
    days_back: {
      type: 'number',
      description: 'How many days of history to consider. Defaults to 365.',
      minimum: 1,
      maximum: 730,
      default: 365,
    },
  },
  required: ['origin', 'destination'],
  additionalProperties: false,
} as const;

export const ROUTE_CAPACITY_CHANGE_OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Route-level capacity and frequency change intelligence for an origin→destination airport pair.',
  properties: {
    origin: { type: 'string', description: 'Echo of the input origin IATA code.' },
    destination: { type: 'string', description: 'Echo of the input destination IATA code.' },
    changes: {
      type: 'array',
      description:
        'Per-carrier change objects for the route pair, one row per carrier per comparison window, ordered by most recent comparison.',
      items: {
        type: 'object',
        properties: {
          carrier: { type: 'string', description: 'IATA carrier code (e.g. "AA").' },
          carrier_name: CARRIER_NAME_SCHEMA,
          is_unresolved: IS_UNRESOLVED_SCHEMA,
          comparison_period: {
            type: 'string',
            description: 'Comparison window, e.g. "2025-Q3 vs 2025-Q2".',
          },
          change_type: {
            type: 'string',
            enum: [...CHANGE_TYPE_ENUM],
            description:
              'Classification of the change. NOTE: first_observed_in_dataset and re_observed_after_gap are dataset observations from BTS T-100 only, NOT confirmed real-world launch dates — they reflect the earliest quarter SkyPulse has data for that route, which may post-date the actual marketing launch. growth/reduction/gauge_up/gauge_down are quarter-over-quarter deltas with both quarters in the dataset.',
          },
          prior_frequency: {
            type: ['integer', 'null'],
            description: 'Total departures in the prior window (null for launches).',
          },
          current_frequency: {
            type: ['integer', 'null'],
            description: 'Total departures in the current window (null for suspensions).',
          },
          frequency_change_abs: {
            type: ['integer', 'null'],
            description: 'Absolute change in departures (current − prior).',
          },
          frequency_change_pct: {
            type: ['number', 'null'],
            description: 'Percentage change in departures.',
          },
          prior_inferred_seats: {
            type: ['integer', 'null'],
            description: 'Inferred seat capacity in the prior window.',
          },
          current_inferred_seats: {
            type: ['integer', 'null'],
            description: 'Inferred seat capacity in the current window.',
          },
          capacity_change_abs: {
            type: ['integer', 'null'],
            description: 'Absolute change in inferred seats.',
          },
          capacity_change_pct: {
            type: ['number', 'null'],
            description: 'Percentage change in inferred seats.',
          },
          aircraft_type_mix_prior: AIRCRAFT_MIX_SCHEMA,
          aircraft_type_mix_current: AIRCRAFT_MIX_SCHEMA,
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Per-row confidence score.',
          },
          known_unknowns: {
            type: ['string', 'null'],
            description: 'Per-row gaps (missing mix data, single-source, etc.) or null.',
          },
          source_refs: { type: 'array', items: SOURCE_REF_SCHEMA },
        },
        required: [
          'carrier',
          'comparison_period',
          'change_type',
          'prior_frequency',
          'current_frequency',
          'frequency_change_abs',
          'frequency_change_pct',
          'prior_inferred_seats',
          'current_inferred_seats',
          'capacity_change_abs',
          'capacity_change_pct',
          'aircraft_type_mix_prior',
          'aircraft_type_mix_current',
          'confidence',
          'known_unknowns',
          'source_refs',
        ],
        additionalProperties: false,
      },
    },
    ...FRESHNESS_PROPERTIES,
  },
  required: [
    'origin',
    'destination',
    'changes',
    'as_of',
    'comparison_period',
    'source_refs',
    'confidence',
    'known_unknowns',
    'data_freshness',
  ],
  additionalProperties: false,
} as const;

// ── new_route_launches ───────────────────────────────────────────────────────

export const NEW_ROUTE_LAUNCHES_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    airport: {
      type: 'string',
      description: 'IATA airport code to query (matches origin OR destination).',
      minLength: 3,
      maxLength: 3,
      examples: ['ORD', 'ATL', 'SEA'],
    },
    period: {
      type: 'string',
      description:
        'Optional period filter, e.g. "2025-Q3" or "2025-08". If omitted, returns all recent periods.',
      examples: ['2025-Q3', '2025-08'],
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description:
        'Maximum number of routes to return. Defaults to 30 (chosen so hub-airport responses stay small enough for fast LLM synthesis). Set up to 100 to retrieve the full list. Routes are ranked by current_inferred_seats DESC so the top N are the most consequential.',
      examples: [30, 100],
    },
  },
  required: ['airport'],
  additionalProperties: false,
} as const;

export const NEW_ROUTE_LAUNCHES_OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Routes first observed (or re-observed after a gap) at a given airport in the BTS T-100 dataset. NOTE: these are dataset observations, NOT confirmed real-world launch dates — the actual marketing launch may pre-date the earliest quarter SkyPulse has data for. Use for historical attribution and trend analysis, not for real-time launch tracking.',
  properties: {
    airport: { type: 'string', description: 'Echo of the input airport IATA code.' },
    period: {
      type: 'string',
      description: 'Echo of the period filter, or "all" if no filter was supplied.',
    },
    routes: {
      type: 'array',
      description: 'One entry per first_observed_in_dataset or re_observed_after_gap route-carrier combination.',
      items: {
        type: 'object',
        properties: {
          carrier: { type: 'string', description: 'IATA carrier code.' },
          carrier_name: CARRIER_NAME_SCHEMA,
          is_unresolved: IS_UNRESOLVED_SCHEMA,
          origin: { type: 'string', description: 'IATA origin airport code.' },
          destination: { type: 'string', description: 'IATA destination airport code.' },
          change_type: {
            type: 'string',
            enum: ['first_observed_in_dataset', 're_observed_after_gap'],
            description: 'first_observed_in_dataset = earliest quarter the route appears in our T-100 window (NOT a confirmed marketing launch); re_observed_after_gap = activity resumed after ≥1 quarter of zero T-100 reports (could be a true resumption, a seasonal route, or a reporting gap).',
          },
          comparison_period: {
            type: 'string',
            description: 'Comparison window this launch/resumption was detected in.',
          },
          current_frequency: {
            type: ['integer', 'null'],
            description: 'Departures in the current window.',
          },
          current_inferred_seats: {
            type: ['integer', 'null'],
            description: 'Inferred seats in the current window.',
          },
          effective_date: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601 timestamp marking the midpoint of the BTS reporting quarter where the route was first/re-observed. This is NOT a confirmed marketing launch date — it is a quarter-midpoint anchor used for ordering and grouping. The true real-world launch may have occurred days, weeks, or months before this date.',
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          source_refs: { type: 'array', items: SOURCE_REF_SCHEMA },
        },
        required: [
          'carrier',
          'origin',
          'destination',
          'change_type',
          'comparison_period',
          'current_frequency',
          'current_inferred_seats',
          'effective_date',
          'confidence',
          'source_refs',
        ],
        additionalProperties: false,
      },
    },
    total_available: {
      type: 'integer',
      minimum: 0,
      description:
        'Total matching routes available before the limit was applied. When greater than routes.length, the response was trimmed; re-call with a higher `limit` (max 100) to retrieve more.',
    },
    limit_applied: {
      type: 'integer',
      minimum: 1,
      description: 'The limit value (default 30) that was applied to produce `routes`.',
    },
    ...FRESHNESS_PROPERTIES,
  },
  required: [
    'airport',
    'period',
    'routes',
    'total_available',
    'limit_applied',
    'as_of',
    'comparison_period',
    'source_refs',
    'confidence',
    'known_unknowns',
    'data_freshness',
  ],
  additionalProperties: false,
} as const;

// ── frequency_losers ─────────────────────────────────────────────────────────

export const FREQUENCY_LOSERS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    market: {
      type: 'string',
      description:
        'Optional IATA airport code to scope the leaderboard. If omitted, returns the network-wide leaderboard.',
      minLength: 3,
      maxLength: 3,
      examples: ['ATL', 'LAX'],
    },
    period: {
      type: 'string',
      description: 'Optional period filter (e.g. "2025-Q3"). If omitted, returns recent periods.',
      examples: ['2025-Q3'],
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description:
        'Maximum number of loser routes to return. Defaults to 30 to keep hub-airport responses small enough for fast LLM synthesis. Set up to 100 to retrieve the full list.',
      examples: [30, 100],
    },
  },
  additionalProperties: false,
} as const;

export const FREQUENCY_LOSERS_OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Routes losing the most frequency/capacity, ranked by steepest percentage decline.',
  properties: {
    market: {
      type: ['string', 'null'],
      description: 'Echo of the market filter, or null if network-wide.',
    },
    period: {
      type: ['string', 'null'],
      description: 'Echo of the period filter, or null.',
    },
    losers: {
      type: 'array',
      description: 'Ordered list of routes with the biggest frequency reductions.',
      items: {
        type: 'object',
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' },
          carrier: { type: 'string' },
          carrier_name: CARRIER_NAME_SCHEMA,
          is_unresolved: IS_UNRESOLVED_SCHEMA,
          comparison_period: { type: 'string' },
          frequency_change_pct: {
            type: 'number',
            description: 'Negative number; largest declines first.',
          },
          frequency_change_abs: { type: 'integer' },
          prior_frequency: { type: 'integer' },
          current_frequency: { type: 'integer' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'origin',
          'destination',
          'carrier',
          'comparison_period',
          'frequency_change_pct',
          'frequency_change_abs',
          'prior_frequency',
          'current_frequency',
          'confidence',
        ],
        additionalProperties: false,
      },
    },
    total_available: {
      type: 'integer',
      minimum: 0,
      description:
        'Total matching loser routes available before the limit was applied. When greater than losers.length, the response was trimmed; re-call with a higher `limit` (max 100) to retrieve more.',
    },
    limit_applied: {
      type: 'integer',
      minimum: 1,
      description: 'The limit value (default 30) that was applied to produce `losers`.',
    },
    ...FRESHNESS_PROPERTIES,
  },
  required: [
    'market',
    'period',
    'losers',
    'total_available',
    'limit_applied',
    'as_of',
    'comparison_period',
    'source_refs',
    'confidence',
    'known_unknowns',
    'data_freshness',
  ],
  additionalProperties: false,
} as const;

// ── capacity_driver_analysis ─────────────────────────────────────────────────

export const CAPACITY_DRIVER_ANALYSIS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    origin: {
      type: 'string',
      description: 'IATA origin airport code.',
      minLength: 3,
      maxLength: 3,
      examples: ['SFO'],
    },
    destination: {
      type: 'string',
      description: 'IATA destination airport code.',
      minLength: 3,
      maxLength: 3,
      examples: ['ORD'],
    },
    carrier: {
      type: 'string',
      description: 'Optional IATA carrier code (2 chars). If omitted, returns all carriers.',
      minLength: 2,
      maxLength: 2,
      examples: ['UA', 'AA'],
    },
  },
  required: ['origin', 'destination'],
  additionalProperties: false,
} as const;

export const CAPACITY_DRIVER_ANALYSIS_OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Determines whether capacity change on a route is frequency-driven (more/fewer flights) or gauge-driven (larger/smaller aircraft).',
  properties: {
    origin: { type: 'string' },
    destination: { type: 'string' },
    carrier: {
      type: ['string', 'null'],
      description: 'Echo of the carrier filter, or null.',
    },
    analysis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          carrier: { type: 'string' },
          carrier_name: CARRIER_NAME_SCHEMA,
          is_unresolved: IS_UNRESOLVED_SCHEMA,
          comparison_period: { type: 'string' },
          driver: {
            type: 'string',
            enum: ['frequency_driven', 'gauge_driven', 'mixed', 'flat', 'decline'],
            description:
              'Primary driver of capacity change. gauge_driven = aircraft up-gauged, frequency_driven = more/fewer flights, mixed = both move together, flat = <5% change, decline = contraction.',
          },
          frequency_change_pct: { type: ['number', 'null'] },
          capacity_change_pct: { type: ['number', 'null'] },
          aircraft_type_mix_prior: AIRCRAFT_MIX_SCHEMA,
          aircraft_type_mix_current: AIRCRAFT_MIX_SCHEMA,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          known_unknowns: { type: ['string', 'null'] },
        },
        required: [
          'carrier',
          'comparison_period',
          'driver',
          'frequency_change_pct',
          'capacity_change_pct',
          'aircraft_type_mix_prior',
          'aircraft_type_mix_current',
          'confidence',
          'known_unknowns',
        ],
        additionalProperties: false,
      },
    },
    ...FRESHNESS_PROPERTIES,
  },
  required: [
    'origin',
    'destination',
    'carrier',
    'analysis',
    'as_of',
    'comparison_period',
    'source_refs',
    'confidence',
    'known_unknowns',
    'data_freshness',
  ],
  additionalProperties: false,
} as const;

// ── carrier_capacity_ranking ─────────────────────────────────────────────────

export const CARRIER_CAPACITY_RANKING_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    market: {
      type: 'string',
      description:
        'IATA airport code defining the market (matches origin OR destination).',
      minLength: 3,
      maxLength: 3,
      examples: ['DFW', 'LAX'],
    },
    aircraft_category: {
      type: 'string',
      enum: ['narrowbody', 'widebody', 'regional_jet', 'turboprop', 'other'],
      description:
        'Optional category filter. Only rows whose dominant current aircraft falls in the category are counted.',
    },
    period: {
      type: 'string',
      description: 'Optional period filter (e.g. "2025-Q3").',
      examples: ['2025-Q3'],
    },
  },
  required: ['market'],
  additionalProperties: false,
} as const;

export const CARRIER_CAPACITY_RANKING_OUTPUT_SCHEMA = {
  type: 'object',
  description:
    'Ranks carriers in the given market by total seat capacity change.',
  properties: {
    market: { type: 'string' },
    aircraft_category: { type: ['string', 'null'] },
    period: { type: ['string', 'null'] },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer', minimum: 1 },
          carrier: { type: 'string' },
          carrier_name: CARRIER_NAME_SCHEMA,
          is_unresolved: IS_UNRESOLVED_SCHEMA,
          total_capacity_change_abs: {
            type: 'integer',
            description:
              'Signed net capacity change (current quarter total seats minus prior quarter total seats). Negative when the carrier contracted on net at this market.',
          },
          total_capacity_change_pct: { type: 'number' },
          total_capacity_added_seats: {
            type: 'integer',
            description:
              'Sum of POSITIVE capacity contributions only — added seats from growth, gauge_up, first_observed_in_dataset and re_observed_after_gap rows. The default ranking is sorted by this field DESC so "Which carriers added the most capacity at <market>?" is answered correctly even in contraction quarters where every carrier nets negative.',
          },
          total_current_seats: { type: 'integer' },
          total_prior_seats: { type: 'integer' },
          routes_gained: {
            type: 'integer',
            description: 'Count of first_observed_in_dataset / re_observed_after_gap / growth / gauge_up rows for the carrier in scope.',
          },
          routes_lost: {
            type: 'integer',
            description: 'Count of suspension / reduction / gauge_down rows for the carrier in scope.',
          },
          routes_unchanged: {
            type: 'integer',
            description: 'Count of rows where |freq change| < 5% and |capacity change| < 5%.',
          },
          top_routes: {
            type: 'array',
            description:
              'Up to 3 routes that contributed most to this carrier\'s capacity change in the analysis window, ordered by signed capacity_change_abs DESC. Use these directly to answer "which routes drove the gain?" — no follow-up call to new_route_launches is needed.',
            items: {
              type: 'object',
              properties: {
                origin: { type: 'string', minLength: 3, maxLength: 3 },
                destination: { type: 'string', minLength: 3, maxLength: 3 },
                capacity_change_abs: { type: 'integer' },
                change_type: { type: 'string' },
                comparison_period: { type: 'string' },
              },
              required: [
                'origin',
                'destination',
                'capacity_change_abs',
                'change_type',
                'comparison_period',
              ],
              additionalProperties: false,
            },
          },
        },
        required: [
          'rank',
          'carrier',
          'total_capacity_change_abs',
          'total_capacity_change_pct',
          'total_capacity_added_seats',
          'total_current_seats',
          'total_prior_seats',
          'routes_gained',
          'routes_lost',
          'routes_unchanged',
          'top_routes',
        ],
        additionalProperties: false,
      },
    },
    ...FRESHNESS_PROPERTIES,
  },
  required: [
    'market',
    'aircraft_category',
    'period',
    'ranking',
    'as_of',
    'comparison_period',
    'source_refs',
    'confidence',
    'known_unknowns',
    'data_freshness',
  ],
  additionalProperties: false,
} as const;

// ── Error envelope (returned when isError: true) ─────────────────────────────

export const ERROR_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Stable machine-readable error code.' },
    message: { type: 'string' },
    details: {},
  },
  required: ['error', 'message'],
  additionalProperties: false,
} as const;
