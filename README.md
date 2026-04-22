# SkyPulse — Airline Route Change & Capacity Intelligence

[![MCP](https://img.shields.io/badge/MCP-Query%20Mode-%230066cc)](https://docs.ctxprotocol.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://typescriptlang.org)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple)](https://railway.app)

SkyPulse is a **Query-mode MCP server** ($0.10/response) that unbundles route-level schedule change and capacity intelligence from OAG Schedules Analyser and Cirium Diio Mi — making it available through the Context Protocol marketplace.

> **Tier A Grant Approved** — US domestic + selected US-international routes at launch.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Context Protocol                              │
│  (agent execution, JWT signing, billing, Optimization skill)          │
└────────────────────────────────┬─────────────────────────────────────┘
                                  │ HTTPS · JSON-RPC (Streamable HTTP)
                                  │ POST /mcp · Authorization: Bearer <ctx-jwt>
┌────────────────────────────────▼─────────────────────────────────────┐
│                      SkyPulse MCP Server (Express)                    │
│   createContextMiddleware()  →  StreamableHTTPServerTransport         │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                          5 MCP Tools                          │   │
│   │   route_capacity_change      │  new_route_launches            │   │
│   │   frequency_losers           │  capacity_driver_analysis      │   │
│   │   carrier_capacity_ranking                                   │   │
│   │   (all with inputSchema + outputSchema + _meta)              │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                   │                                   │
│   ┌───────────────┐  ┌────────────▼─────────────┐  ┌──────────────┐ │
│   │  Redis cache  │  │    PostgreSQL data store  │  │ Cron jobs    │ │
│   │  (ioredis)    │◄─│    route_snapshots        │◄─│ (node-cron)  │ │
│   │   hot answers │  │    route_changes          │  │ Sunday 02Z   │ │
│   │               │  │    route_announcements    │  │ Daily    06Z │ │
│   └───────────────┘  └───────────────────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                   ▲
                 ┌─────────────────┴──────────────────┐
                 │  Data sources (pre-ingested only)   │
                 │   DOT/BTS T-100 Segment (ZIP/CSV)   │
                 │   FAA OPSNET/ASPM                   │
                 │   Airline press releases / JSON feed│
                 └─────────────────────────────────────┘
```

**Why HTTP and not stdio?** Context Protocol requires the MCP Streamable HTTP transport so the platform can route signed JWT requests (`Authorization: Bearer <ctx-jwt>`) and account for billing. Stdio is for local dev tools only and is not accepted by the marketplace.

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 15+
- **Redis** 7+
- **npm** 9+

---

## Local Setup

```bash
git clone https://github.com/<your-org>/skypulse.git
cd skypulse
npm install
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL
npm run migrate               # apply migrations 001–003 (schema + indexes)
npm run seed                  # 100 airports, 98 carriers (incl. LatAm/cargo), 31 aircraft types
npm run build                 # tsc compile
npm run dev                   # boots HTTP server on http://localhost:3000
```

The running server exposes:

| Path      | Method    | Purpose                                                    |
| --------- | --------- | ---------------------------------------------------------- |
| `/`       | GET       | JSON metadata (name, version, endpoints)                   |
| `/health` | GET       | 200 OK health probe for Railway                            |
| `/mcp`    | POST, GET | MCP Streamable HTTP transport (guarded by Context JWT auth) |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Redis connection string |
| `PORT` | no (default 3000) | HTTP port for `/mcp` |
| `TOOL_URL` | prod | Public URL of your `/mcp` endpoint — used as Context JWT audience |
| `RUN_CRON` | prod | Set to `true` on exactly one replica to enable weekly / daily cron jobs |
| `T100_DATA_URL` | no | HTTPS mirror of your latest BTS T-100 ZIP/CSV (weekly cron fetches this) |
| `ANNOUNCEMENT_FEED_URL` | no | JSON feed of airline press releases (daily cron fetches this) |
| `NODE_ENV` | yes | `production` in prod |
| `LOG_LEVEL` | no | `debug`/`info`/`warn`/`error` (default `info`) |

---

## Ingesting T-100 Data (important)

BTS removed predictable public URLs from their `/PREZIP` directory in 2015. The current official distribution channel is a session-based download form at **https://www.transtats.bts.gov/DL_SelectFields.asp?gnoyr_VQ=FIL** which returns a ZIP with a random numeric prefix (e.g. `932989999_T_T100D_SEGMENT_US_CARRIER_ONLY.zip`). **Deep links to `DL_SelectFields.asp` bounce to the BTS homepage** unless you reach them by clicking through the navigation tree (they depend on ASP session cookies) — see the nav path below.

SkyPulse therefore supports **three ingestion paths**:

### A. Manual one-shot ingestion (dev / first run)
```bash
npm run ingest:t100 -- --file ./data/T_T100_SEGMENT_ALL_CARRIER.csv
# or
npm run ingest:t100 -- --file ./data/raw.zip
```

### B. HTTP mirror (production)
Upload the BTS ZIP or its extracted CSV to any stable HTTPS host you control (Cloudflare R2, S3, Railway volume, a GitHub Release attachment, etc.), then:
```bash
export T100_DATA_URL=https://your-mirror.example.com/t100_segment_latest.zip
npm run ingest:t100 -- --url "$T100_DATA_URL"
```
Set `T100_DATA_URL` in your Railway env and the Sunday 02:00 UTC cron will refresh automatically.

### C. `--origin` / `--destination` scoping (smoke tests)
```bash
npm run ingest:t100 -- --file ./data/raw.zip --origin JFK --destination LAX
```

### C2. Batch-ingest a folder of monthly ZIPs (`--dir`)
BTS's download form times out on full-year pulls for T-100 Segment All-Carrier. The practical workaround is to download **one month at a time** into `./data/` and let the ingester walk the folder:
```bash
npm run ingest:t100 -- --dir ./data
```
All `.zip` and `.csv` files in the directory are processed in sorted order. Upserts are idempotent on `(origin, destination, carrier, period, source)` so rerunning is safe. `recomputeRouteChanges` runs **once at the end** (not after each file) to keep the batch fast.

Use `--dry-run` to parse + aggregate without writing to the DB (great for verifying a fresh BTS download is well-formed).

### D. Instant-start with the bundled fixture (no BTS required)
A deterministic 9-month synthetic fixture ships in the repo so you can validate the full stack before the first real BTS pull.
```bash
npm run fixture:t100                              # regenerates fixtures/sample_t100.csv
npm run ingest:t100 -- --file fixtures/sample_t100.csv
```
The fixture is written to `./fixtures/` (not `./data/`) so `npm run ingest:t100 -- --dir ./data` never picks it up alongside real BTS ZIPs. It exercises every change type (launch / suspension / growth / reduction / unchanged / aircraft upgauge) across JFK-LAX, ORD-DEN, ATL-MIA, BOS-MCO, DFW-PHX, SEA-PDX.

> **Warning.** The fixture uses `source='dot_t100'` — the same source tag as real BTS data — so if you have previously ingested it and later ingest real BTS ZIPs, the fixture's 13 route-carrier tuples may have overwritten real rows on `(origin, destination, carrier, period)`. Run `npm run clean:fixture` afterwards (idempotent, supports `--dry-run`) to purge any fixture-only months, then re-run `npm run recompute`.

### How to download T-100 from BTS (reality-based walkthrough)

The "direct link" (`DL_SelectFields.asp?gnoyr_VQ=FIL&Table_ID=259`) redirects to the homepage unless you arrive through the site's navigation tree. Do this:

1. Open [https://www.transtats.bts.gov/DataIndex.asp](https://www.transtats.bts.gov/DataIndex.asp) (this sets the ASP session cookies).
2. Click **Aviation** → **Air Carrier Statistics (Form 41 Traffic) — All Carriers**.
3. Scroll to **T-100 Segment (All Carriers)** and click **Download**.
4. On the column-picker form:
   - **Filter Year**: pick a recent year (start with `2025`).
   - **Filter Period**: leave **All Months** checked (or pick a single month for a faster download).
   - **Select All** for columns (our parser ignores unused ones; at minimum we need `UNIQUE_CARRIER`, `ORIGIN`, `DEST`, `AIRCRAFT_TYPE`, `DEPARTURES_PERFORMED`, `SEATS`, `MONTH`, `YEAR`).
   - Check **Prezipped File** at the bottom.
   - Click **Download**.
5. Save the randomly-named ZIP into `./data/` and run `npm run ingest:t100 -- --file ./data/<that-file>.zip`.

**If the form still bounces you to the homepage**: open the site in a private/incognito window and click through the nav tree again without any deep links. The session state does not survive copy-pasted URLs.

### Alternative T-100 sources (if BTS is uncooperative)

| Source | Freshness | Access |
|---|---|---|
| Google BigQuery `bigquery-public-data.faa.t100_segment` | typically 1 quarter behind BTS | SQL → export as CSV, ingest with `--file` |
| data.transportation.gov (DOT open-data portal) | same as BTS | browse for "T-100 Segment" datasets; direct CSV downloads |
| Cirium / OAG commercial feeds | daily | paid; wire into `T100_DATA_URL` once you hold a license |

After every T-100 ingestion, `recomputeRouteChanges()` runs automatically and rebuilds the `route_changes` table at quarterly granularity.

### Announcement feed (optional, recommended)
Set `ANNOUNCEMENT_FEED_URL` to a JSON endpoint serving:
```json
{
  "announcements": [
    {
      "carrier": "DL",
      "origin": "ATL",
      "destination": "LAX",
      "type": "launch",
      "effective_date": "2026-06-01",
      "announced_date": "2026-04-15",
      "url": "https://news.delta.com/...",
      "text": "Delta announces new ATL-LAX service..."
    }
  ]
}
```

---

## MCP Tool Reference

Every tool response includes these fields (grant-reviewer requirement):

| Field | Meaning |
|---|---|
| `as_of` | ISO 8601 timestamp the answer was computed |
| `comparison_period` | Time windows compared, e.g. `"2025-Q3 vs 2025-Q2"` |
| `source_refs` | Array of `{ source, vintage, url? }` |
| `confidence` | 0–1 per-response confidence score |
| `known_unknowns` | Explicit data gaps or lag disclosure |
| `data_freshness` | `Source: DOT T-100 <quarter> (published <month year>) + Press Releases through <month year> — as of <iso>` |

`carrier_name` is populated on every per-row object via a JOIN against the carriers reference table.

### Tools

| Tool | Input | Returns |
|---|---|---|
| `route_capacity_change` | `{ origin, destination, days_back? }` | Per-carrier deltas (freq, inferred seats, aircraft mix) |
| `new_route_launches` | `{ airport, period? }` | Launched + resumed routes with effective date |
| `frequency_losers` | `{ market?, period? }` | Ranked routes by steepest freq decline |
| `capacity_driver_analysis` | `{ origin, destination, carrier? }` | `gauge_driven` vs `frequency_driven` vs `mixed` vs `flat` vs `decline` |
| `carrier_capacity_ranking` | `{ market, aircraft_category?, period? }` | Carrier leaderboard by seat change |

Complete JSON Schemas (used as MCP `outputSchema` and by the Ajv test suite) live in `src/tools/schemas.ts`.

---

## Data Freshness & Source Lag

SkyPulse uses **pre-ingested data only** — no live scraping at query time. This ensures sub-5s p95 latency on cold cache and < 100ms on warm cache.

| Source | Typical lag | Coverage |
|---|---|---|
| DOT/BTS T-100 Segment | 3–6 months | US domestic + US-international |
| FAA OPSNET | 1–2 months | US airport operations (supplementary) |
| Airline press releases | 0–7 days | Forward-looking launches/suspensions |

The `data_freshness` field on every response explicitly labels the live data vintage and the latest announcement date for the query scope.

---

## Cron Schedule (opt-in per replica via `RUN_CRON=true`)

| Schedule | Job | Behavior |
|---|---|---|
| `0 2 * * 0` (Sun 02:00 UTC) | T-100 refresh | Fetches `T100_DATA_URL` if set, ingests, recomputes `route_changes`, flushes cache |
| `0 6 * * *` (daily 06:00 UTC) | Announcement scan | Fetches `ANNOUNCEMENT_FEED_URL` if set, inserts rows, recomputes `route_changes`, flushes cache |

---

## Railway Deployment

```bash
railway init
# Add PostgreSQL and Redis plugins from the dashboard.
# Railway injects DATABASE_URL and REDIS_URL automatically.

railway variables set NODE_ENV=production
railway variables set LOG_LEVEL=info
railway variables set RUN_CRON=true
railway variables set TOOL_URL=https://<your-app>.up.railway.app/mcp
railway variables set T100_DATA_URL=https://<your-mirror>/t100_segment_latest.zip

railway up

railway run npm run migrate
railway run npm run seed
# One-time bootstrap of T-100:
railway run npm run ingest:t100 -- --url "$T100_DATA_URL"
```

Railway respects the `Procfile` (`web: node dist/index.js`) and exposes the service on the Railway-assigned port which Express reads from `PORT`.

---

## Submitting to the Context Protocol Marketplace

1. Deploy Railway as above. Confirm `GET https://<your-app>.up.railway.app/health` returns `{ ok: true }`.
2. Run the protocol self-tests (see **Testing** below).
3. Visit **https://ctxprotocol.com** → Developers → **Contribute Tool**.
4. Fill the form: name `skypulse`, URL `https://<your-app>.up.railway.app/mcp`, pricing `$0.10/response`, category *Aviation / Market Intelligence*.
5. Stake required USDC (your wallet must have deposits — see the grant email).
6. Submit. Send the public URL + one sample tools/call response to `grants@ctxprotocol.com` referencing your approved grant.
7. After approval, run the **Optimization Skill** from the Context dashboard. Ship a new deploy whenever it recommends description tweaks.

---

## Testing

SkyPulse ships with a Jest suite that validates schemas and protocol conformance; a running instance can also be exercised with curl or the official MCP Inspector.

### 1. Static checks
```bash
npm run typecheck         # tsc --noEmit under strict mode
npm test                  # Ajv validation + in-process MCP tools/list integration
```
The suite covers:
- Every `outputSchema` validates against realistic row + empty-result fixtures.
- Drifted property names (`asOf` vs `as_of`) are explicitly rejected.
- `tools/list` returns every tool with `inputSchema`, `outputSchema`, and `_meta.queryEligible=true`.

### 2. Local HTTP smoke test (no DB needed for tools/list)
```bash
npm run build && npm start &
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```
You should see all 5 tools with `outputSchema` and `_meta` populated.

### 3. Authenticated tool call (needs DB + Redis + ingested T-100)
```bash
# tools/call is protected by createContextMiddleware. In dev, set TOOL_URL
# unset to relax audience checking, and sign your own test JWT, OR use the
# MCP Inspector which uses its own dev-mode transport:
npx @modelcontextprotocol/inspector node dist/index.js
```

### 4. End-to-end sample flow (with data)
```bash
# 1. Bootstrap
npm run migrate && npm run seed
# 2. Ingest a T-100 file (CSV or ZIP)
npm run ingest:t100 -- --file ./data/T_T100_SEGMENT_ALL_CARRIER.csv
# 3. Recompute route_changes (also runs automatically post-ingest)
npm run recompute
# 4. Call a tool via MCP Inspector or curl and verify:
#    - structuredContent shape matches outputSchema
#    - data_freshness reflects the actual latest vintage
#    - carrier_name is populated from the carriers join
```

### 5. Latency budget
Response time targets:
- `route_capacity_change`: p95 < 3s cold, < 100ms warm (Redis)
- `carrier_capacity_ranking`: p95 < 5s cold, < 150ms warm

Every tool handler is wrapped in a 25s soft timeout; if this fires, the response is a structured `TOOL_TIMEOUT` error rather than a platform cancellation.

---

## Project Structure

```
SKYPULSE/
├── src/
│   ├── index.ts                    # Express + HTTP transport + Context middleware
│   ├── server.ts                   # Tool registry, dispatch, timeout wrap, structured errors
│   ├── tools/
│   │   ├── schemas.ts              # JSON Schemas for every tool (input + output)
│   │   ├── routeChange.ts          # route_capacity_change
│   │   ├── routeLaunches.ts        # new_route_launches
│   │   ├── carrierComparison.ts    # frequency_losers
│   │   ├── capacityAnalysis.ts     # capacity_driver_analysis
│   │   └── marketLeaderboard.ts    # carrier_capacity_ranking
│   ├── pipeline/
│   │   └── recompute.ts            # route_snapshots → quarterly → route_changes
│   ├── ingestion/
│   │   ├── dotT100.ts              # File / URL / ZIP T-100 ingestion + CLI
│   │   └── announcements.ts        # JSON-feed announcements
│   ├── normalization/
│   │   ├── airportCodes.ts
│   │   ├── carrierCodes.ts
│   │   ├── aircraftTypes.ts
│   │   ├── changeDetection.ts
│   │   └── confidenceScoring.ts
│   ├── db/
│   │   ├── connection.ts
│   │   ├── migrations/001_initial_schema.sql
│   │   ├── queries.ts
│   │   ├── migrate.ts
│   │   └── seed.ts
│   ├── cache/redis.ts
│   ├── cron/scheduler.ts
│   ├── types/index.ts
│   └── utils/{freshness.ts,logger.ts}
├── tests/
│   ├── schemas.test.ts             # Ajv schema tests (realistic fixtures)
│   └── server.test.ts              # In-process MCP tools/list conformance
├── package.json · tsconfig.json · jest.config.ts
├── .env.example · Procfile · railway.toml
└── README.md
```

---

## Contributing

1. Fork the repo, create a feature branch.
2. `npm install && npm run build && npm test`.
3. Every tool change must update `src/tools/schemas.ts` and keep Ajv tests green.
4. No request-time scraping. Ever.

---

## License

MIT
