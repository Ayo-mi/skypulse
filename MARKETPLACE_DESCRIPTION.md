# SkyPulse — Marketplace Description

Use this as the `description` field when updating the listing via the Context
SDK (`client.developer.updateTool(toolId, { description })`) or in the
developer dashboard.

Name: **SkyPulse** (note the capital **P**)
Category: **Real World**
Price: **$0.10 / response**

---

SkyPulse delivers airline route-change and capacity intelligence derived directly from U.S. DOT / Bureau of Transportation Statistics (BTS) T-100 Segment filings. Built for aviation analysts, commercial planners, airport authorities, and travel-tech teams who need OAG-grade route economics without the six-figure subscription.

What sets SkyPulse apart:
- Pre-computed route changes: every launch, suspension, resumption, growth, reduction, gauge_up, and gauge_down is materialized up-front, so every tool call returns in sub-second from the cache.
- Evidence-rich response envelope: every response carries `confidence` (0–1), `known_unknowns`, `source_refs`, and `data_freshness` so agents can reason about answer reliability without a follow-up tool call.
- Explicit data vintage: responses cite the exact BTS T-100 vintage month and quarter used (e.g. "BTS T-100 vintage Jan 2026 (period 2026-Q1)"), not a hand-wavy "recent data" label.
- 100% structured output: every tool returns `structuredContent` alongside the text payload, matching its `outputSchema` exactly for schema-aware agents.

Coverage (as of April 2026)
- Data: BTS T-100 Segment, 7 rolling months of real filings (Jul 2025 – Jan 2026, ~190,000 segment-level snapshots)
- Airports: 1,780 distinct IATA codes (US domestic + US-international)
- Carriers: 306 IATA + DOT codes including mainline, low-cost, regional, cargo, and LatAm/Caribbean operators
- Aircraft types: 70+ IATA codes mapped to BTS numeric codes with inferred seat configuration and aircraft category

Typical BTS publication lag is 3–6 months after the reporting month closes; SkyPulse re-ingests as each new BTS vintage publishes. Announcement data (press releases) layers on top to bridge the lag window when available.

Tools

- `route_capacity_change` — per-carrier frequency, seat, and aircraft-mix deltas for a specific airport pair (e.g. JFK-LAX). Supports `days_back` windowing.
- `new_route_launches` — all launched or resumed carrier-routes at a given airport. Supports `period` quarterly filter.
- `frequency_losers` — top N routes by steepest frequency decline. Optional market filter.
- `capacity_driver_analysis` — classifies capacity change on a route as frequency-driven, gauge-driven, or mixed, with aircraft-mix evidence.
- `carrier_capacity_ranking` — carrier leaderboard for a market, ranked by absolute seat-capacity change. Supports `aircraft_category` (narrowbody / widebody / regional_jet / turboprop) and `period`.

Try asking

- "Which carriers added the most capacity on JFK-LAX over the past 365 days?"
- "What new routes launched from ORD in 2025-Q3?"
- "Rank carriers at DFW by total seat capacity change in 2026-Q1."
- "Did LAX-NRT capacity grow because of more weekly flights or larger aircraft?"
- "Which ATL routes are losing the most frequency year-over-year?"
- "Show the top narrowbody capacity gainers in the Miami market this quarter."
- "Launches from MIA in 2026-Q1."

Agent tips

- Pass airport codes as 3-letter IATA (e.g. `JFK`, not `KJFK`).
- `period` strings use `YYYY-Qn` format (e.g. `2026-Q1`); omit to get the most recent comparison the tool can construct.
- `carrier_capacity_ranking` ranks by **total absolute seats gained/lost**. A carrier can rank #1 with zero new-route launches if it gauge-upped on an existing route. Always read `routes_gained`, `routes_lost`, and the capacity delta together, not in isolation.
- Every tool response includes `confidence` and `known_unknowns` — low confidence means partial vintage coverage or unmapped aircraft codes; surface these to end users rather than silencing them.
- `structuredContent` mirrors the schema-typed payload exactly; prefer it over parsing `content[0].text`.
- Carrier IATA codes with no reference row return `carrier_name: null`; the raw IATA code is always populated.

Caveats

- BTS T-100 is historical-actual traffic (not forward schedule); use it for attribution and post-hoc ranking, not for forecasting next quarter's flying.
- Private/general-aviation and non-T-100 filers (e.g. some cargo consolidators, charter-only operators) are out of scope.
- Load factor (passenger / seat) requires the PASSENGERS field, which is on the roadmap — current responses surface capacity only.
