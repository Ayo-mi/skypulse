import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { RouteCapacityChangeSchema, routeCapacityChange } from './tools/routeChange';
import { NewRouteLaunchesSchema, newRouteLaunches } from './tools/routeLaunches';
import { FrequencyLosersSchema, frequencyLosers } from './tools/carrierComparison';
import {
  CapacityDriverAnalysisSchema,
  capacityDriverAnalysis,
} from './tools/capacityAnalysis';
import {
  CarrierCapacityRankingSchema,
  carrierCapacityRanking,
} from './tools/marketLeaderboard';
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
} from './tools/schemas';
import { logger } from './utils/logger';

// ── Tool timeout guard ──────────────────────────────────────────────────────
// Context enforces a ~60s cap on tool execution. We budget 25s hard for
// precomputed-answer tools so we always return a structured error instead of
// letting the platform cancel us mid-flight.
const TOOL_TIMEOUT_MS = 25_000;

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs = TOOL_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        Object.assign(new Error(`Tool timed out after ${timeoutMs}ms: ${label}`), {
          code: 'TOOL_TIMEOUT',
        })
      );
    }, timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(t);
        reject(err);
      });
  });
}

// ── Shared metadata for all Query-mode tools ────────────────────────────────
const QUERY_META = {
  surface: 'query',
  queryEligible: true,
  latencyClass: 'instant',
  rateLimit: {
    maxRequestsPerMinute: 120,
    cooldownMs: 250,
    maxConcurrency: 8,
  },
} as const;

// ── Tool definitions (listed via tools/list) ─────────────────────────────────
export const TOOL_DEFINITIONS = [
  {
    name: 'route_capacity_change',
    description:
      'SINGLE-CALL ANSWER for: "How did capacity/frequency on origin-destination route X change historically?". Historical route-level capacity and frequency intelligence for a specific airport pair, derived exclusively from U.S. DOT / Bureau of Transportation Statistics (BTS) T-100 Segment filings (3-6 month publication lag). Returns per-carrier quarter-over-quarter deltas (frequency, inferred seats, aircraft mix) with explicit data vintage and confidence. The response includes both raw deltas AND aircraft-mix evidence — do NOT also call capacity_driver_analysis or carrier_capacity_ranking for the same route in the same workflow. For both directions of a route, query each direction once. Good prompts: "Which carriers added the most capacity on JFK-LAX in the most recent BTS quarter?" or "Did AA reduce frequency on DFW-ORD between 2025-Q3 and 2025-Q4?".',
    inputSchema: ROUTE_CAPACITY_CHANGE_INPUT_SCHEMA,
    outputSchema: ROUTE_CAPACITY_CHANGE_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'new_route_launches',
    description:
      'SINGLE-CALL ANSWER for: "What new routes appeared at airport X in BTS data?". Routes first observed (or re-observed after a gap) at a given airport in the BTS T-100 dataset. IMPORTANT: change_type values are dataset observations, NOT confirmed real-world launches — `first_observed_in_dataset` means "earliest BTS quarter this carrier-route appears in our window" (which may post-date the marketing launch by months), and `re_observed_after_gap` means "activity resumed after ≥1 quarter of zero T-100 reports" (could be a true resumption, a seasonal route, or a reporting gap). effective_date is the BTS quarter midpoint, not the calendar launch day. Supports `period` filter (e.g. "2025-Q3") for quarterly scoping. Do NOT also call carrier_capacity_ranking afterwards — this tool already lists every first-observed route at the airport. Good prompts: "What routes were first observed in BTS data at ORD in 2025-Q3?" or "Show first-observed and re-observed routes at MIA in 2026-Q1.".',
    inputSchema: NEW_ROUTE_LAUNCHES_INPUT_SCHEMA,
    outputSchema: NEW_ROUTE_LAUNCHES_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'frequency_losers',
    description:
      'SINGLE-CALL ANSWER for: "Which routes lost the most frequency?". Ranks routes by steepest percentage frequency decline quarter-over-quarter in BTS T-100 data. Optionally scoped to a single market (e.g. "ATL"). Historical contraction analysis with the standard 3-6 month BTS publication lag. Self-contained — agents should NOT additionally call route_capacity_change for the same routes; the underlying frequency and capacity numbers are already in the response. Good prompts: "Which US domestic routes lost the most frequency in the most recent BTS quarter?" or "Which ATL routes contracted fastest year-over-year?".',
    inputSchema: FREQUENCY_LOSERS_INPUT_SCHEMA,
    outputSchema: FREQUENCY_LOSERS_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'capacity_driver_analysis',
    description:
      'SINGLE-CALL ANSWER for: "Was capacity change on route X driven by frequency or gauge?". Returns per-carrier driver classification (frequency_driven / gauge_driven / mixed / flat / decline) with full aircraft mix evidence and the underlying frequency_change_pct and capacity_change_pct numbers from BTS T-100 (3-6 month lag). Self-contained — the response already includes the raw deltas, so agents should NOT additionally call route_capacity_change or carrier_capacity_ranking on the same route. For both directions of a route, query each direction in its own call (one call per direction is the intended workflow). Good prompt: "Did LAX-NRT capacity grow because of more weekly flights or larger aircraft in the latest BTS quarter?".',
    inputSchema: CAPACITY_DRIVER_ANALYSIS_INPUT_SCHEMA,
    outputSchema: CAPACITY_DRIVER_ANALYSIS_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'carrier_capacity_ranking',
    description:
      'SINGLE-CALL ANSWER for: "Which carriers added/lost the most capacity at airport X?", including the SPECIFIC ROUTES that drove each carrier\'s ranking. Historical carrier leaderboard for a market (airport IATA), ranked by total absolute seat-capacity change in BTS T-100. EACH carrier in the response includes a `top_routes` array of up to 3 routes that contributed most to that carrier\'s capacity change — agents should NOT additionally call new_route_launches to learn which routes drove the gains, that information is already inline. `routes_gained` counts first_observed_in_dataset / re_observed_after_gap / growth / gauge_up; `routes_lost` counts suspension / reduction / gauge_down. Optional `aircraft_category` filter (narrowbody / widebody / regional_jet / turboprop) and `period` filter (e.g. "2026-Q1"). Source: BTS T-100 Segment, 3-6 month publication lag. Good prompts: "Which carriers added the most narrowbody capacity at MIA this quarter?" (single call — top_routes shows you exactly which routes), "Rank carriers at DFW by total seat capacity change in 2026-Q1".',
    inputSchema: CARRIER_CAPACITY_RANKING_INPUT_SCHEMA,
    outputSchema: CARRIER_CAPACITY_RANKING_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
];

// ── Tool dispatch table ──────────────────────────────────────────────────────
type ToolHandler = (args: unknown) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  route_capacity_change: async (args) => {
    const input = RouteCapacityChangeSchema.parse(args);
    return routeCapacityChange(input);
  },
  new_route_launches: async (args) => {
    const input = NewRouteLaunchesSchema.parse(args);
    return newRouteLaunches(input);
  },
  frequency_losers: async (args) => {
    const input = FrequencyLosersSchema.parse(args);
    return frequencyLosers(input);
  },
  capacity_driver_analysis: async (args) => {
    const input = CapacityDriverAnalysisSchema.parse(args);
    return capacityDriverAnalysis(input);
  },
  carrier_capacity_ranking: async (args) => {
    const input = CarrierCapacityRankingSchema.parse(args);
    return carrierCapacityRanking(input);
  },
};

export function createServer(): Server {
  const server = new Server(
    {
      name: 'skypulse',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];

    if (!handler) {
      return errorResponse('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    }

    const startedAt = Date.now();
    try {
      const result = await withTimeout(name, () => handler(args));
      logger.info('tools/call success', {
        tool: name,
        elapsed_ms: Date.now() - startedAt,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      const elapsed = Date.now() - startedAt;

      if (err instanceof z.ZodError) {
        logger.warn('tools/call invalid input', { tool: name, errors: err.errors, elapsed });
        return errorResponse('INVALID_INPUT', 'Input validation failed', err.errors);
      }

      const code =
        (err as { code?: string }).code === 'TOOL_TIMEOUT'
          ? 'TOOL_TIMEOUT'
          : 'TOOL_ERROR';
      const message = err instanceof Error ? err.message : 'Internal error';
      logger.error('tools/call failure', { tool: name, code, message, elapsed });
      return errorResponse(code, message);
    }
  });

  return server;
}

function errorResponse(
  error: string,
  message: string,
  details?: unknown
): {
  content: { type: 'text'; text: string }[];
  structuredContent: { error: string; message: string; details?: unknown };
  isError: true;
} {
  const payload: { error: string; message: string; details?: unknown } = {
    error,
    message,
  };
  if (details !== undefined) payload.details = details;
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}
