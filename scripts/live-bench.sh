#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Live MCP endpoint benchmark.
#
# Hits the deployed SkyPulse endpoint over HTTP exactly the way Context's
# gateway does (JSON-RPC 2.0 over POST, Accept: text/event-stream), measures
# end-to-end wall-clock per call, and prints a pass/fail table against the
# reviewer's 30s threshold.
#
# Run AFTER setting NODE_ENV=development + SKIP_CTX_AUTH=true on Railway.
# Reset both env vars immediately when the script finishes.
#
# Usage: bash live-bench.sh
# ─────────────────────────────────────────────────────────────────────────────

set -u
ENDPOINT="${ENDPOINT:-https://web-production-b949a.up.railway.app/mcp}"

# Each entry: "label|tool|args-json"
CASES=(
  # Round-3 / round-4 reviewer-tested prompts
  "new_route_launches(ORD, 2025-Q3)|new_route_launches|{\"airport\":\"ORD\",\"period\":\"2025-Q3\"}"
  "new_route_launches(BOS, 2026-Q1)|new_route_launches|{\"airport\":\"BOS\",\"period\":\"2026-Q1\"}"
  "new_route_launches(SEA, 2026-Q1)|new_route_launches|{\"airport\":\"SEA\",\"period\":\"2026-Q1\"}"
  "new_route_launches(LAS, 2026-Q1)|new_route_launches|{\"airport\":\"LAS\",\"period\":\"2026-Q1\"}"
  "carrier_capacity_ranking(JFK, 2026-Q1)|carrier_capacity_ranking|{\"market\":\"JFK\",\"period\":\"2026-Q1\"}"
  "new_route_launches(ORD)|new_route_launches|{\"airport\":\"ORD\"}"
  "carrier_capacity_ranking(MIA, narrowbody)|carrier_capacity_ranking|{\"market\":\"MIA\",\"aircraft_category\":\"narrowbody\"}"
  # Round-4 reviewer specifics: SEA-NRT data gap + multi-call probes
  "route_capacity_change(SEA, NRT)|route_capacity_change|{\"origin\":\"SEA\",\"destination\":\"NRT\"}"
  "route_capacity_change(NRT, SEA)|route_capacity_change|{\"origin\":\"NRT\",\"destination\":\"SEA\"}"
  "capacity_driver_analysis(SEA, NRT)|capacity_driver_analysis|{\"origin\":\"SEA\",\"destination\":\"NRT\"}"
  "capacity_driver_analysis(LAX, NRT)|capacity_driver_analysis|{\"origin\":\"LAX\",\"destination\":\"NRT\"}"
  "carrier_capacity_ranking(JFK)|carrier_capacity_ranking|{\"market\":\"JFK\"}"
  "frequency_losers(ATL)|frequency_losers|{\"market\":\"ATL\"}"
  "route_capacity_change(ATL, ORD)|route_capacity_change|{\"origin\":\"ATL\",\"destination\":\"ORD\"}"
  # Round-5 reviewer specifics: flagship "no aircraft_category" prompt + hub
  # payloads that previously triggered slow LLM synthesis (100+ rows).
  "carrier_capacity_ranking(JFK, 2026-Q1, all-aircraft)|carrier_capacity_ranking|{\"market\":\"JFK\",\"period\":\"2026-Q1\"}"
  "carrier_capacity_ranking(PHL, 2025-Q3, all-aircraft)|carrier_capacity_ranking|{\"market\":\"PHL\",\"period\":\"2025-Q3\"}"
  "new_route_launches(LAS, default top-30)|new_route_launches|{\"airport\":\"LAS\"}"
  "new_route_launches(ATL, default top-30)|new_route_launches|{\"airport\":\"ATL\"}"
  "new_route_launches(LAS, limit=100)|new_route_launches|{\"airport\":\"LAS\",\"limit\":100}"
  "frequency_losers(ATL, default top-30)|frequency_losers|{\"market\":\"ATL\"}"
)

printf "\n%-50s %10s %10s %s\n" "PROMPT" "TIME" "STATUS" "RESULT"
printf "%-50s %10s %10s %s\n" "--------------------------------------------------" "----------" "----------" "------"

PASS=0
FAIL=0

for entry in "${CASES[@]}"; do
  label="${entry%%|*}"
  rest="${entry#*|}"
  tool="${rest%%|*}"
  args="${rest#*|}"

  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args")

  body_file=$(mktemp)
  http_code=$(curl -s -o "$body_file" -w "%{http_code}|%{time_total}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data "$payload")

  status="${http_code%|*}"
  elapsed="${http_code#*|}"

  # First non-empty data: line in the SSE stream is the actual response.
  preview=$(sed -n 's/^data: //p' "$body_file" | head -1 \
    | jq -r '.result.structuredContent | (.routes // .ranking // .changes // .losers // .analysis | length // "n/a")' 2>/dev/null \
    || echo "(no items)")
  rm -f "$body_file"

  # Compare elapsed (seconds, decimal) against 30s threshold.
  under_30=$(awk -v t="$elapsed" 'BEGIN { print (t+0 < 30.0) ? "PASS" : "FAIL" }')
  if [ "$status" != "200" ]; then
    under_30="FAIL"
  fi
  if [ "$under_30" = "PASS" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

  printf "%-50s %9.2fs %10s items=%s (HTTP %s)\n" "$label" "$elapsed" "$under_30" "$preview" "$status"
done

printf "\n%s\n" "----------------------------------------------------------------------------------"
printf "Total: %d passed, %d failed (30s threshold)\n" "$PASS" "$FAIL"
printf "%s\n\n" "----------------------------------------------------------------------------------"

# Reminder
echo "REMINDER: revert NODE_ENV=production and remove SKIP_CTX_AUTH on Railway now."

exit $FAIL
