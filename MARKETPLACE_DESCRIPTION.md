# SkyPulse — Marketplace Description

Use this as the `description` field when updating the listing via the Context
SDK (`client.developer.updateTool(toolId, { description })`) or in the
developer dashboard.

Name: **SkyPulse** (note the capital **P**)
Category: **Real World**
Price: **$0.10 / response**

---

SkyPulse delivers historical airline route-change and capacity intelligence derived exclusively from U.S. DOT / Bureau of Transportation Statistics (BTS) T-100 Segment filings. Built for aviation analysts, commercial planners, airport authorities, and travel-tech teams who need OAG-grade post-hoc route economics without the six-figure subscription. Use it for historical attribution, quarter-over-quarter capacity ranking, and trend analysis — not for real-time launch tracking.

What sets SkyPulse apart:
- Pre-computed historical change rows: every quarter-over-quarter delta (first_observed_in_dataset, suspension, re_observed_after_gap, growth, reduction, gauge_up, gauge_down) is materialized up-front, so every tool call returns in sub-second from the cache.
- Evidence-rich response envelope: every response carries `confidence` (0–1), `known_unknowns`, `source_refs`, and `data_freshness` so agents can reason about answer reliability without a follow-up tool call.
- Explicit data vintage: responses cite the exact BTS T-100 vintage month and quarter used (e.g. "BTS T-100 Segment vintage Jan 2026 (period 2026-Q1)"), plus the standard 3-6 month BTS publication lag — never a hand-wavy "recent data" label.
- Honest dataset semantics: change_type values reflect what we observed in BTS, not unverified real-world claims. `first_observed_in_dataset` means "earliest BTS quarter we have for this carrier-route" (which may post-date the actual marketing launch), `re_observed_after_gap` means "activity resumed after ≥1 quarter of zero T-100 reports". This avoids false-positive launches.
- 100% structured output: every tool returns `structuredContent` alongside the text payload, matching its `outputSchema` exactly for schema-aware agents.

Coverage (as of April 2026)
- Data: BTS T-100 Segment, 7 rolling months of real filings (Jul 2025 – Jan 2026, ~190,000 segment-level snapshots)
- Airports: 1,780 distinct IATA codes (US domestic + US-international)
- Carriers: 350+ IATA + ICAO + DOT codes including mainline, low-cost, regional, cargo, charter, and LatAm/Caribbean operators
- Aircraft types: 70+ IATA codes mapped to BTS numeric codes with inferred seat configuration and aircraft category

Typical BTS publication lag is 3–6 months after the reporting month closes; SkyPulse re-ingests as each new BTS vintage publishes.

Tools

- `route_capacity_change` — per-carrier frequency, seat, and aircraft-mix deltas for a specific airport pair (e.g. JFK-LAX). Supports `days_back` windowing.
- `new_route_launches` — first-observed and re-observed-after-gap routes at a given airport in the BTS T-100 dataset. NOT a real-time launch feed — see "Agent tips". Supports `period` quarterly filter.
- `frequency_losers` — top N routes by steepest historical frequency decline. Optional market filter.
- `capacity_driver_analysis` — classifies historical capacity change on a route as frequency-driven, gauge-driven, or mixed, with aircraft-mix evidence.
- `carrier_capacity_ranking` — carrier leaderboard for a market, ranked by absolute seat-capacity change. Supports `aircraft_category` (narrowbody / widebody / regional_jet / turboprop) and `period`.

Try asking

- "Which carriers added the most capacity on JFK-LAX in the most recent BTS quarter?"
- "What routes were first observed in BTS data at ORD in 2025-Q3?"
- "Rank carriers at DFW by total seat capacity change in 2026-Q1."
- "Did LAX-NRT capacity grow because of more weekly flights or larger aircraft?"
- "Which ATL routes lost the most frequency year-over-year?"
- "Show the top narrowbody capacity gainers in the Miami market this quarter."
- "First-observed routes at MIA in 2026-Q1."

Agent tips

- SkyPulse is a **historical** intelligence product. Data is BTS T-100 Segment with the standard 3-6 month publication lag — there is no live schedule-source or press-release layer. Don't use it for "is this route launching next month?" questions.
- `new_route_launches` returns rows where `change_type` is `first_observed_in_dataset` or `re_observed_after_gap`. These are dataset observations, NOT confirmed marketing launches: a `first_observed_in_dataset` row simply means "the earliest BTS quarter we have data for this carrier-route", which may post-date the actual launch by months. `effective_date` is the BTS quarter midpoint, not the calendar launch day. Confidence on these rows is capped at 0.6 to reflect this — surface that to end users.
- Pass airport codes as 3-letter IATA (e.g. `JFK`, not `KJFK`).
- `period` strings use `YYYY-Qn` format (e.g. `2026-Q1`); omit to get the most recent comparison the tool can construct.
- `carrier_capacity_ranking` ranks by **total absolute seats gained/lost**. A carrier can rank #1 with zero first_observed routes if it gauge-upped on an existing route. Always read `routes_gained`, `routes_lost`, and the capacity delta together, not in isolation.
- Every tool response includes `confidence` and `known_unknowns` — low confidence means partial vintage coverage, missing aircraft mix, or unmapped carrier codes; surface these to end users rather than silencing them.
- `structuredContent` mirrors the schema-typed payload exactly; prefer it over parsing `content[0].text`.
- Carriers whose BTS code does not resolve to a known operator are returned as `carrier_name: "Unresolved (BTS code: <X>)"` with `is_unresolved: true` — typically charter, small-cargo, or BTS-internal codes. The raw IATA code is always populated.

Caveats

- BTS T-100 is historical-actual traffic (not forward schedule); use it for attribution and post-hoc ranking, not for forecasting next quarter's flying.
- Private/general-aviation and non-T-100 filers (e.g. some cargo consolidators, charter-only operators) are out of scope.
- Load factor (passenger / seat) requires the PASSENGERS field, which is on the roadmap — current responses surface capacity only.
- No live press-release / schedule-source corroboration layer in v1; all rows are derived from BTS T-100 only. This is intentional — see the "honest dataset semantics" bullet above.
