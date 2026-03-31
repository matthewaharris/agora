#!/usr/bin/env bash
# =============================================================================
# OACP API Integration Test Script
#
# Tests all OACP endpoints against a running Supabase instance.
# Prerequisites: supabase start && supabase functions serve --no-verify-jwt
#
# Usage: ./scripts/test-api.sh [BASE_URL]
# Default BASE_URL: http://localhost:54321/functions/v1/oacp
# =============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:54321/functions/v1/oacp}"
PASS=0
FAIL=0

# Colors (if terminal supports it)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

pass() {
  PASS=$((PASS + 1))
  echo -e "${GREEN}  [PASS]${NC} $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo -e "${RED}  [FAIL]${NC} $1: $2"
}

info() {
  echo -e "${YELLOW}---${NC} $1"
}

# =============================================================================
# Test 1: Health Check
# =============================================================================
info "Test 1: Health Check"

HEALTH=$(curl -s "${BASE_URL}/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "GET /health returns status:ok"
else
  fail "GET /health" "Expected status:ok, got: $HEALTH"
fi

if echo "$HEALTH" | grep -q '"version":"0.1.0"'; then
  pass "GET /health returns version:0.1.0"
else
  fail "GET /health version" "Expected version:0.1.0"
fi

# =============================================================================
# Test 2: Register Agent A (research-summarization)
# =============================================================================
info "Test 2: Register Agent A"

# Generate a fake Ed25519 public key (64 hex chars)
FAKE_PK_A="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

REG_A=$(curl -s -X POST "${BASE_URL}/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"test-research-agent\",
    \"owner_handle\": \"matt\",
    \"description\": \"Test agent for research summarization\",
    \"capabilities\": [\"research-summarization\"],
    \"public_key\": \"${FAKE_PK_A}\"
  }")

AGENT_A_ID=$(echo "$REG_A" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4)
TOKEN_A=$(echo "$REG_A" | grep -o '"registry_token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$AGENT_A_ID" ]; then
  pass "POST /register returns agent_id: ${AGENT_A_ID:0:8}..."
else
  fail "POST /register" "No agent_id in response: $REG_A"
fi

if [ -n "$TOKEN_A" ]; then
  pass "POST /register returns registry_token"
else
  fail "POST /register" "No registry_token in response"
fi

# =============================================================================
# Test 3: Register Agent B (data-extraction)
# =============================================================================
info "Test 3: Register Agent B"

FAKE_PK_B="b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"

REG_B=$(curl -s -X POST "${BASE_URL}/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"test-extraction-agent\",
    \"owner_handle\": \"friend\",
    \"description\": \"Test agent for data extraction\",
    \"capabilities\": [\"data-extraction\"],
    \"public_key\": \"${FAKE_PK_B}\"
  }")

AGENT_B_ID=$(echo "$REG_B" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4)
TOKEN_B=$(echo "$REG_B" | grep -o '"registry_token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$AGENT_B_ID" ]; then
  pass "POST /register Agent B: ${AGENT_B_ID:0:8}..."
else
  fail "POST /register Agent B" "No agent_id in response: $REG_B"
fi

# =============================================================================
# Test 4: Heartbeat
# =============================================================================
info "Test 4: Heartbeat Agent A"

if [ -n "$AGENT_A_ID" ] && [ -n "$TOKEN_A" ]; then
  HB=$(curl -s -X POST "${BASE_URL}/heartbeat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN_A}" \
    -d "{\"agent_id\": \"${AGENT_A_ID}\"}")

  if echo "$HB" | grep -q '"status":"online"'; then
    pass "POST /heartbeat returns status:online"
  else
    fail "POST /heartbeat" "Expected status:online, got: $HB"
  fi

  if echo "$HB" | grep -q '"last_seen_at"'; then
    pass "POST /heartbeat returns last_seen_at"
  else
    fail "POST /heartbeat" "No last_seen_at in response"
  fi
else
  fail "POST /heartbeat" "Skipped — no agent_id or token from registration"
fi

# =============================================================================
# Test 5: Heartbeat with bad token (should fail)
# =============================================================================
info "Test 5: Heartbeat with invalid token"

if [ -n "$AGENT_A_ID" ]; then
  BAD_HB=$(curl -s -X POST "${BASE_URL}/heartbeat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer bad-token-12345" \
    -d "{\"agent_id\": \"${AGENT_A_ID}\"}")

  if echo "$BAD_HB" | grep -q '"error"'; then
    pass "POST /heartbeat rejects invalid token"
  else
    fail "POST /heartbeat bad token" "Should have returned error: $BAD_HB"
  fi
fi

# =============================================================================
# Test 6: Discover all agents
# =============================================================================
info "Test 6: Discover all agents"

DISC_ALL=$(curl -s "${BASE_URL}/discover")

if echo "$DISC_ALL" | grep -q '"agents"'; then
  pass "GET /discover returns agents array"
else
  fail "GET /discover" "No agents array: $DISC_ALL"
fi

if echo "$DISC_ALL" | grep -q '"total"'; then
  pass "GET /discover returns total count"
else
  fail "GET /discover" "No total count"
fi

# Verify registry_token is NOT in response
if echo "$DISC_ALL" | grep -q 'registry_token'; then
  fail "GET /discover" "registry_token should not be in response!"
else
  pass "GET /discover strips registry_token from results"
fi

# =============================================================================
# Test 7: Discover by capability
# =============================================================================
info "Test 7: Discover by capability"

DISC_CAP=$(curl -s "${BASE_URL}/discover?capability=research-summarization")

if echo "$DISC_CAP" | grep -q 'research-summarization'; then
  pass "GET /discover?capability=research-summarization finds agent"
else
  fail "GET /discover by capability" "research-summarization agent not found: $DISC_CAP"
fi

# Should NOT find data-extraction in research-summarization results
if echo "$DISC_CAP" | grep -q 'data-extraction' && ! echo "$DISC_CAP" | grep -q 'research-summarization'; then
  fail "GET /discover by capability" "Found wrong agent"
else
  pass "GET /discover by capability filters correctly"
fi

# =============================================================================
# Test 8: Discover by status
# =============================================================================
info "Test 8: Discover by status"

DISC_ONLINE=$(curl -s "${BASE_URL}/discover?status=online")

if echo "$DISC_ONLINE" | grep -q '"agents"'; then
  pass "GET /discover?status=online returns results"
else
  fail "GET /discover by status" "No results: $DISC_ONLINE"
fi

# =============================================================================
# Test 9: Register validation errors
# =============================================================================
info "Test 9: Validation errors"

VAL_ERR=$(curl -s -X POST "${BASE_URL}/register" \
  -H "Content-Type: application/json" \
  -d '{"name": ""}')

if echo "$VAL_ERR" | grep -q '"error"'; then
  pass "POST /register rejects empty name"
else
  fail "POST /register validation" "Should reject empty body: $VAL_ERR"
fi

# Bad public key
BAD_PK=$(curl -s -X POST "${BASE_URL}/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","capabilities":["x"],"public_key":"not-hex"}')

if echo "$BAD_PK" | grep -q '"error"'; then
  pass "POST /register rejects invalid public_key"
else
  fail "POST /register pk validation" "Should reject bad public_key: $BAD_PK"
fi

# =============================================================================
# Test 10: Re-registration
# =============================================================================
info "Test 10: Re-registration"

if [ -n "$AGENT_A_ID" ] && [ -n "$TOKEN_A" ]; then
  REREG=$(curl -s -X POST "${BASE_URL}/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN_A}" \
    -d "{
      \"agent_id\": \"${AGENT_A_ID}\",
      \"name\": \"updated-research-agent\",
      \"capabilities\": [\"research-summarization\", \"web-search\"],
      \"public_key\": \"${FAKE_PK_A}\"
    }")

  if echo "$REREG" | grep -q '"updated":true'; then
    pass "POST /register re-registration updates agent"
  else
    fail "POST /register re-registration" "Expected updated:true, got: $REREG"
  fi
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
