#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PARSED="$(curl -fsS -X POST "$BASE_URL/api/mandates/parse" \
  -H 'content-type: application/json' \
  -d '{"instruction":"I need one mouse under $30 from approved merchants."}')"
MANDATE_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["mandate"]["mandate_id"])' <<< "$PARSED")"

curl -fsS -X POST "$BASE_URL/api/mandates/$MANDATE_ID/confirm" -H 'content-type: application/json' -d '{}'
curl -fsS -X POST "$BASE_URL/api/agent/run" -H 'content-type: application/json' \
  -d "{\"mandate_id\":\"$MANDATE_ID\",\"mode\":\"protected\"}"
curl -fsS -X POST "$BASE_URL/api/agent/run" -H 'content-type: application/json' \
  -d "{\"mandate_id\":\"$MANDATE_ID\",\"mode\":\"naive\"}"
curl -fsS "$BASE_URL/api/audit?mandate_id=$MANDATE_ID"
