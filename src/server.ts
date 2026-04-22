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
      'Route-level capacity and frequency change intelligence for a specific airport pair, derived from U.S. DOT / Bureau of Transportation Statistics (BTS) T-100 Segment filings. Returns per-carrier deltas (frequency, inferred seats, aircraft mix) with explicit data vintage and confidence scoring. A premium answer product unbundled from OAG Schedules Analyser / Cirium Diio Mi for the covered US domestic + US-international market. Good prompts: "Which carriers added the most capacity on JFK-LAX over the past 365 days?" or "Has AA reduced frequency on DFW-ORD this quarter?".',
    inputSchema: ROUTE_CAPACITY_CHANGE_INPUT_SCHEMA,
    outputSchema: ROUTE_CAPACITY_CHANGE_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'new_route_launches',
    description:
      'Detect new route launches and service resumptions at a given airport, sourced from BTS T-100 Segment filings. Returns every launched/resumed carrier-route with inferred seats and effective period. Supports a `period` filter (e.g. "2025-Q3") for quarterly scoping. Good prompts: "What new routes launched from ORD in 2025-Q3?", "Which carriers resumed service to SEA last quarter?", or "Launches from MIA in 2026-Q1".',
    inputSchema: NEW_ROUTE_LAUNCHES_INPUT_SCHEMA,
    outputSchema: NEW_ROUTE_LAUNCHES_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'frequency_losers',
    description:
      'Ranks routes losing the most frequency (BTS T-100), ordered by steepest percentage decline. Optionally scoped to a single market (e.g. "ATL"). Useful for competitive intelligence and market contraction analysis. Good prompts: "Which US domestic routes lost the most frequency year-over-year?" or "Which ATL routes are contracting fastest?".',
    inputSchema: FREQUENCY_LOSERS_INPUT_SCHEMA,
    outputSchema: FREQUENCY_LOSERS_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'capacity_driver_analysis',
    description:
      'Determines whether capacity change on a route is driven by frequency (more/fewer flights) or gauge (larger/smaller aircraft). Returns per-carrier driver classification with aircraft mix evidence from BTS T-100. Good prompt: "Did LAX-NRT capacity grow because of more weekly flights or larger aircraft?".',
    inputSchema: CAPACITY_DRIVER_ANALYSIS_INPUT_SCHEMA,
    outputSchema: CAPACITY_DRIVER_ANALYSIS_OUTPUT_SCHEMA,
    _meta: QUERY_META,
  },
  {
    name: 'carrier_capacity_ranking',
    description:
      'Carrier leaderboard for a given market (airport IATA), ranked by total seat-capacity change (absolute seats added or removed year-over-year). A carrier may rank #1 with zero new route launches if it up-gauged aircraft on existing routes; `routes_gained` and `routes_lost` are reported alongside the seat delta so agents can attribute the ranking correctly. Optional `aircraft_category` filter (narrowbody / widebody / regional_jet / turboprop) and `period` filter (e.g. "2026-Q1"). Source: BTS T-100 Segment. Good prompts: "Which carriers added the most narrowbody capacity in the Dallas market this quarter?" or "Rank carriers at MIA by total seat capacity change in 2026-Q1".',
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
