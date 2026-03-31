---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T04: Integration test script and final verification

1. Create test script (scripts/test-api.sh or similar) that:\n   - Calls /health and checks response\n   - Registers an agent and captures agent_id + token\n   - Sends heartbeat and verifies last_seen_at updated\n   - Registers a second agent with different capabilities\n   - Discovers by capability tag and verifies results\n   - Verifies re-registration works\n2. Verify all handlers compile (no syntax errors)\n3. Commit all S02 work

## Inputs

- `supabase/functions/oacp/index.ts`

## Expected Output

- `scripts/test-api.sh`

## Verification

Test script exists with all endpoint tests; all Edge Function files have valid structure
