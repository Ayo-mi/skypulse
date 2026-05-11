// ─────────────────────────────────────────────────────────────────────────────
// LLM-shape simulation harness.
//
// Why this exists: smoke tests and live-bench both call the tools with
// hand-crafted, tool-author-approved arguments. Neither of them exercises
// what an actual LLM orchestrator does — pick values from the schema with
// limited context.
//
// The R6 reviewer found a bug that was invisible to every other test we
// have: the LLM, when faced with an aircraft_category enum that lacked a
// neutral choice, picked "other" as a default and got an empty ranking.
// This script brute-forces every "neutral-looking" value an LLM might pass
// (undefined, null, "", "all", " ALL ", "any", and the actual enum values)
// and asserts that the unfiltered cases all return a useful ranking.
//
// Run after every schema change that touches a tool input:
//
//   DATABASE_URL=<railway-public-url> REDIS_URL=<railway-redis-url> \
//     npx ts-node scripts/llmShapeTest.ts
//
// Exit code 0 = every "neutral" call shape produces a useful answer.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { closePool } from '../src/db/connection';
import { getRedis } from '../src/cache/redis';
import {
  CarrierCapacityRankingSchema,
  carrierCapacityRanking,
} from '../src/tools/marketLeaderboard';
import { NewRouteLaunchesSchema, newRouteLaunches } from '../src/tools/routeLaunches';
import { FrequencyLosersSchema, frequencyLosers } from '../src/tools/carrierComparison';

interface Case {
  label: string;
  args: Record<string, unknown>;
  expectUseful: boolean; // true = must return a non-empty ranking with positive top entry
}

function assertUseful(
  label: string,
  ranking: { total_capacity_added_seats?: number }[],
  expectUseful: boolean
): boolean {
  const count = ranking.length;
  const topAdded = ranking[0]?.total_capacity_added_seats ?? 0;
  const ok = expectUseful ? count > 0 && topAdded > 0 : true;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(60)} count=${String(count).padStart(3)}  top_added=${topAdded}`
  );
  return ok;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    console.error('DATABASE_URL and REDIS_URL must be set');
    process.exit(1);
  }
  await getRedis().flushdb();

  let pass = 0;
  let fail = 0;

  // ── carrier_capacity_ranking — the R6 hot spot ─────────────────────────────
  console.log('\n=== carrier_capacity_ranking aircraft_category enum guard ===');
  const rankingCases: Case[] = [
    { label: 'no aircraft_category',                args: { market: 'JFK', period: '2026-Q1' },                            expectUseful: true },
    { label: 'aircraft_category="all"',             args: { market: 'JFK', period: '2026-Q1', aircraft_category: 'all' },  expectUseful: true },
    { label: 'aircraft_category=""',                args: { market: 'JFK', period: '2026-Q1', aircraft_category: '' },     expectUseful: true },
    { label: 'aircraft_category=null',              args: { market: 'JFK', period: '2026-Q1', aircraft_category: null },   expectUseful: true },
    { label: 'aircraft_category="any"',             args: { market: 'JFK', period: '2026-Q1', aircraft_category: 'any' },  expectUseful: true },
    { label: 'aircraft_category=" ALL "',           args: { market: 'JFK', period: '2026-Q1', aircraft_category: ' ALL ' }, expectUseful: true },
    { label: 'aircraft_category="narrowbody"',      args: { market: 'JFK', period: '2026-Q1', aircraft_category: 'narrowbody' }, expectUseful: true },
    { label: 'aircraft_category="widebody"',        args: { market: 'JFK', period: '2026-Q1', aircraft_category: 'widebody' },   expectUseful: true },
    // "other" is a legitimate filter — the bucket may genuinely be empty at
    // some hubs. We don't assert usefulness here, just that the call
    // succeeds end-to-end.
    { label: 'aircraft_category="other" (may be empty)', args: { market: 'JFK', period: '2026-Q1', aircraft_category: 'other' }, expectUseful: false },
  ];
  for (const c of rankingCases) {
    try {
      const parsed = CarrierCapacityRankingSchema.parse(c.args);
      const r = await carrierCapacityRanking(parsed);
      const ok = assertUseful(c.label, r.ranking, c.expectUseful);
      if (ok) pass++;
      else fail++;
    } catch (e) {
      fail++;
      console.log(`[FAIL] ${c.label}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Same flagship prompt across multiple hubs — the R5/R6 regression specifics.
  console.log('\n=== flagship "no aircraft_category" prompt across hubs ===');
  for (const market of ['JFK', 'PHL', 'DFW', 'LAX', 'ORD']) {
    const r = await carrierCapacityRanking(
      CarrierCapacityRankingSchema.parse({ market, period: '2026-Q1' })
    );
    const ok = assertUseful(`flagship ${market} 2026-Q1`, r.ranking, true);
    if (ok) pass++;
    else fail++;
  }

  // ── new_route_launches — default limit guard ────────────────────────────────
  console.log('\n=== new_route_launches default limit guard ===');
  for (const airport of ['LAS', 'ORD', 'ATL', 'BOS']) {
    const parsed = NewRouteLaunchesSchema.parse({ airport, period: '2026-Q1' });
    const r = await newRouteLaunches(parsed);
    const okShape = r.routes.length <= 30 && r.limit_applied === 30 && r.total_available > 0;
    console.log(
      `[${okShape ? 'PASS' : 'FAIL'}] ${airport} default top-30   routes=${r.routes.length}  total_available=${r.total_available}  limit_applied=${r.limit_applied}`
    );
    if (okShape) pass++;
    else fail++;
  }

  // ── frequency_losers — default limit guard ──────────────────────────────────
  console.log('\n=== frequency_losers default limit guard ===');
  for (const market of ['ATL', 'ORD']) {
    const parsed = FrequencyLosersSchema.parse({ market, period: '2026-Q1' });
    const r = await frequencyLosers(parsed);
    const okShape = r.losers.length <= 30 && r.limit_applied === 30;
    console.log(
      `[${okShape ? 'PASS' : 'FAIL'}] ${market} default top-30   losers=${r.losers.length}  total_available=${r.total_available}  limit_applied=${r.limit_applied}`
    );
    if (okShape) pass++;
    else fail++;
  }

  console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
  await closePool();
  await getRedis().quit();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('LLM shape test crashed:', err);
  process.exit(1);
});
