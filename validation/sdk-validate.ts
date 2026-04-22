// SkyPulse Context Marketplace QA — Step 4 validator
// Runs discovery + 5 representative query-mode prompts through the live
// Context Protocol platform against the listed tool. No secrets are logged.

import { ContextClient } from '@ctxprotocol/sdk';
import * as fs from 'fs';
import * as path from 'path';

type PromptCase = { id: string; primaryTool: string; query: string };

const TOOL_ID = '580555be-16e6-4ee0-8b26-3b41ad7a417e';

const PROMPTS: PromptCase[] = [
  {
    id: 'P1',
    primaryTool: 'route_capacity_change',
    query:
      'Which carriers added the most capacity on JFK-LAX over the past year?',
  },
  {
    id: 'P2',
    primaryTool: 'new_route_launches',
    query: 'What new routes launched from ORD in 2025-Q3?',
  },
  {
    id: 'P3',
    primaryTool: 'frequency_losers',
    query: 'Which US domestic routes lost the most frequency year-over-year?',
  },
  {
    id: 'P4',
    primaryTool: 'capacity_driver_analysis',
    query:
      'Did LAX-NRT capacity grow because of more flights or larger aircraft?',
  },
  {
    id: 'P5',
    primaryTool: 'carrier_capacity_ranking',
    query:
      'Which carriers added the most narrowbody capacity in the Dallas market this quarter?',
  },
];

type StepResult = {
  step: string;
  ok: boolean;
  detail: unknown;
};

async function main(): Promise<void> {
  const apiKey = process.env.CONTEXT_API_KEY;
  if (!apiKey) {
    console.error('CONTEXT_API_KEY env var is required');
    process.exit(1);
  }

  const client = new ContextClient({ apiKey });
  const results: StepResult[] = [];

  // ── 4.1 Fetch listing by ID ────────────────────────────────────────────
  try {
    const tool = await client.discovery.get(TOOL_ID);
    results.push({
      step: '4.1 discovery.get(TOOL_ID)',
      ok: true,
      detail: {
        id: tool.id,
        name: tool.name,
        category: (tool as unknown as { category?: string }).category,
        description_len: tool.description?.length ?? 0,
        endpoint:
          (tool as unknown as { endpoint?: string; url?: string }).endpoint ??
          (tool as unknown as { url?: string }).url,
        mcpTools_count: Array.isArray(
          (tool as unknown as { mcpTools?: unknown[] }).mcpTools
        )
          ? (tool as unknown as { mcpTools: unknown[] }).mcpTools.length
          : undefined,
        mcpTool_names: Array.isArray(
          (tool as unknown as { mcpTools?: Array<{ name?: string }> }).mcpTools
        )
          ? (
              tool as unknown as { mcpTools: Array<{ name?: string }> }
            ).mcpTools.map((m) => m.name)
          : undefined,
        price:
          (tool as unknown as { price?: string | number }).price ??
          (tool as unknown as { methodPrice?: string }).methodPrice,
        raw_keys: Object.keys(tool as unknown as Record<string, unknown>),
      },
    });
  } catch (err) {
    results.push({
      step: '4.1 discovery.get(TOOL_ID)',
      ok: false,
      detail: { error: String(err) },
    });
  }

  // ── 4.2 Search discoverability ──────────────────────────────────────────
  const searchQueries = [
    'airline capacity routes',
    'flight route capacity intelligence',
    'route launches airport',
  ];
  for (const q of searchQueries) {
    try {
      const hits = await client.discovery.search(q, 20);
      const found = hits.find((t) => t.id === TOOL_ID);
      results.push({
        step: `4.2 discovery.search("${q}")`,
        ok: !!found,
        detail: {
          total_hits: hits.length,
          skypulse_rank: found
            ? hits.findIndex((t) => t.id === TOOL_ID) + 1
            : null,
          top_5: hits.slice(0, 5).map((t) => ({ id: t.id, name: t.name })),
        },
      });
    } catch (err) {
      results.push({
        step: `4.2 discovery.search("${q}")`,
        ok: false,
        detail: { error: String(err) },
      });
    }
  }

  // ── 4.3 Query-mode prompt suite ─────────────────────────────────────────
  for (const p of PROMPTS) {
    const started = Date.now();
    try {
      const answer = await client.query.run({
        query: p.query,
        tools: [TOOL_ID],
        includeDeveloperTrace: true,
      });
      const elapsedMs = Date.now() - started;

      const a = answer as unknown as {
        response?: string;
        toolsUsed?: unknown[];
        cost?: unknown;
        trace?: unknown;
        developerTrace?: unknown;
        session?: unknown;
      };

      results.push({
        step: `4.3 ${p.id} (${p.primaryTool})`,
        ok: typeof a.response === 'string' && a.response.length > 0,
        detail: {
          query: p.query,
          expected_primary_tool: p.primaryTool,
          elapsed_ms: elapsedMs,
          response_len: a.response?.length ?? 0,
          response_preview: (a.response ?? '').slice(0, 500),
          toolsUsed: a.toolsUsed,
          cost: a.cost,
          trace_summary:
            (a.developerTrace as { summary?: unknown })?.summary ??
            (a.trace as { summary?: unknown })?.summary,
          trace_steps_count: Array.isArray(
            (a.developerTrace as { steps?: unknown[] })?.steps
          )
            ? (a.developerTrace as { steps: unknown[] }).steps.length
            : Array.isArray((a.trace as { steps?: unknown[] })?.steps)
            ? (a.trace as { steps: unknown[] }).steps.length
            : undefined,
          trace_top_steps: Array.isArray(
            (a.developerTrace as { steps?: Array<Record<string, unknown>> })
              ?.steps
          )
            ? (a.developerTrace as { steps: Array<Record<string, unknown>> })
                .steps.slice(0, 3)
                .map((s) => ({
                  tool: s.tool ?? s.toolName,
                  method: s.method ?? s.methodName,
                  status: s.status,
                  durationMs: s.durationMs,
                }))
            : undefined,
          raw_keys: Object.keys(a as Record<string, unknown>),
        },
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      results.push({
        step: `4.3 ${p.id} (${p.primaryTool})`,
        ok: false,
        detail: {
          query: p.query,
          elapsed_ms: Date.now() - started,
          error_code: e.code,
          error_message: e.message ?? String(err),
        },
      });
    }
  }

  client.close();

  const reportPath = path.join(
    __dirname,
    `sdk-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log('\n=== SDK VALIDATION REPORT ===\n');
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.step}`);
    console.log(JSON.stringify(r.detail, null, 2).slice(0, 2000));
    console.log('---');
  }
  console.log(`\nFull report written to: ${reportPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
