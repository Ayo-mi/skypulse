// ─────────────────────────────────────────────────────────────────────────────
// SkyPulse smoke test — runs each of the 5 tool functions directly against
// the configured DATABASE_URL + REDIS_URL, no HTTP / no MCP / no auth in the
// loop. Use this when you want to verify the actual code logic is working
// (or measure end-to-end latency) without depending on Context's UI or
// without having to provision a JWT.
//
// Usage:
//   DATABASE_URL=<railway-public-url> REDIS_URL=<railway-redis-url> \
//     npx ts-node scripts/smokeTest.ts
//
// Optional:
//   SKIP_CACHE=true    → bypass Redis (always hit DB) for cold-call timing
//   AIRPORT=ORD        → only test this airport (default runs ORD/MIA/DFW/JFK/LAX/BOS/ATL)
//   ROUTE=LAX-NRT      → only test this O-D pair for route-level tools
//
// Output: per-call latency, top-line response shape, and a final pass/fail
// summary. Exit code 0 on all pass, 1 on any failure.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { closePool } from '../src/db/connection';
import { newRouteLaunches } from '../src/tools/routeLaunches';
import { carrierCapacityRanking } from '../src/tools/marketLeaderboard';
import { frequencyLosers } from '../src/tools/carrierComparison';
import { capacityDriverAnalysis } from '../src/tools/capacityAnalysis';
import { routeCapacityChange } from '../src/tools/routeChange';
import { getRedis } from '../src/cache/redis';

interface CaseResult {
  name: string;
  ok: boolean;
  ms: number;
  summary: string;
  error?: string;
}

async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  summarise: (v: T) => string
): Promise<CaseResult> {
  const t0 = Date.now();
  try {
    const v = await fn();
    return {
      name,
      ok: true,
      ms: Date.now() - t0,
      summary: summarise(v),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      summary: '(failed)',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summariseList(result: {
  routes?: unknown[];
  ranking?: unknown[];
  analysis?: unknown[];
  changes?: unknown[];
  losers?: unknown[];
  data_freshness?: string;
}): string {
  const items =
    (result.routes?.length ?? 0) +
    (result.ranking?.length ?? 0) +
    (result.analysis?.length ?? 0) +
    (result.changes?.length ?? 0) +
    (result.losers?.length ?? 0);
  return `items=${items} freshness="${(result.data_freshness ?? '').slice(0, 80)}..."`;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is required');
    process.exit(1);
  }
  if (process.env.SKIP_CACHE === 'true') {
    // Force cache miss by salting every key with a random suffix per run.
    // Easiest way without touching tool code: just FLUSHDB.
    const r = getRedis();
    await r.flushdb();
    console.log('Flushed Redis (SKIP_CACHE=true)\n');
  }

  const airports = process.env.AIRPORT
    ? [process.env.AIRPORT]
    : ['ORD', 'MIA', 'DFW', 'JFK', 'LAX', 'BOS', 'ATL'];

  const route = (process.env.ROUTE ?? 'LAX-NRT').split('-');
  const [origin, destination] = [route[0] ?? 'LAX', route[1] ?? 'NRT'];

  const results: CaseResult[] = [];

  console.log('━'.repeat(78));
  console.log('SkyPulse smoke test');
  console.log('━'.repeat(78));
  console.log(`Airports        : ${airports.join(', ')}`);
  console.log(`Route O-D       : ${origin}-${destination}`);
  console.log(`Skip cache      : ${process.env.SKIP_CACHE === 'true' ? 'yes (post-flush)' : 'no (warm if seen before)'}`);
  console.log('');

  // ── 1. new_route_launches per airport ──────────────────────────────────────
  for (const airport of airports) {
    results.push(
      await timed(
        `new_route_launches(${airport})`,
        () => newRouteLaunches({ airport }),
        summariseList
      )
    );
  }

  // ── 2. carrier_capacity_ranking per airport (with top_routes) ──────────────
  for (const airport of airports) {
    results.push(
      await timed(
        `carrier_capacity_ranking(${airport})`,
        () => carrierCapacityRanking({ market: airport }),
        (r) => {
          const items = r.ranking?.length ?? 0;
          const withTop = r.ranking?.filter((c) => (c.top_routes?.length ?? 0) > 0).length ?? 0;
          return `carriers=${items} withTopRoutes=${withTop} freshness="${(r.data_freshness ?? '').slice(0, 60)}..."`;
        }
      )
    );
  }

  // ── 3. carrier_capacity_ranking with narrowbody filter (MIA-style) ─────────
  results.push(
    await timed(
      `carrier_capacity_ranking(MIA, narrowbody)`,
      () => carrierCapacityRanking({ market: 'MIA', aircraft_category: 'narrowbody' }),
      (r) => `carriers=${r.ranking?.length ?? 0}`
    )
  );

  // ── 4. frequency_losers per airport ────────────────────────────────────────
  for (const airport of airports) {
    results.push(
      await timed(
        `frequency_losers(${airport})`,
        () => frequencyLosers({ market: airport }),
        summariseList
      )
    );
  }

  // ── 5. capacity_driver_analysis on the test route ──────────────────────────
  results.push(
    await timed(
      `capacity_driver_analysis(${origin}-${destination})`,
      () => capacityDriverAnalysis({ origin, destination }),
      summariseList
    )
  );

  // ── 6. route_capacity_change on the test route ─────────────────────────────
  results.push(
    await timed(
      `route_capacity_change(${origin}-${destination})`,
      () => routeCapacityChange({ origin, destination }),
      summariseList
    )
  );

  // ── 7. carrier-resolution check: any FI / XP returned with a name? ─────────
  // Look for at least one FI or XP carrier in any ranking response and confirm
  // is_unresolved is false and carrier_name is not "Unresolved (...)".
  const carrierResults: { code: string; resolved: boolean; name: string | undefined }[] = [];
  for (const airport of airports) {
    const r = await carrierCapacityRanking({ market: airport });
    for (const c of r.ranking ?? []) {
      if (c.carrier === 'FI' || c.carrier === 'XP') {
        carrierResults.push({
          code: c.carrier,
          resolved: !c.is_unresolved,
          name: c.carrier_name,
        });
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('━'.repeat(78));
  console.log('Results');
  console.log('━'.repeat(78));
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    const ms = `${r.ms.toString().padStart(6)}ms`;
    console.log(`[${status}] ${ms}  ${r.name.padEnd(45)} ${r.summary}`);
    if (r.error) console.log(`         err: ${r.error}`);
    if (r.ok) pass++;
    else fail++;
  }

  console.log('');
  console.log('━'.repeat(78));
  console.log('Carrier resolution check (FI = Icelandair, XP = Avelo)');
  console.log('━'.repeat(78));
  if (carrierResults.length === 0) {
    console.log('(no FI or XP entries observed in the ranking responses; that\'s fine if neither carrier files segments at the tested airports)');
  } else {
    for (const c of carrierResults) {
      const status = c.resolved && c.name && !c.name.startsWith('Unresolved') ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${c.code.padEnd(3)} → ${c.name ?? '(null)'} (resolved=${c.resolved})`);
      if (status === 'FAIL') fail++;
      else pass++;
    }
  }

  console.log('');
  console.log('━'.repeat(78));
  console.log(`Total: ${pass} passed, ${fail} failed`);
  console.log('━'.repeat(78));

  // Latency targets
  const slow = results.filter((r) => r.ok && r.ms > 30_000);
  if (slow.length > 0) {
    console.log('');
    console.log(`WARNING: ${slow.length} call(s) exceeded the 30s reviewer threshold:`);
    for (const r of slow) console.log(`  - ${r.name}: ${r.ms}ms`);
  }

  await closePool();
  // Force-close redis since getRedis() lazily creates it.
  try {
    const r = getRedis();
    await r.quit();
  } catch {
    // ignore
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
