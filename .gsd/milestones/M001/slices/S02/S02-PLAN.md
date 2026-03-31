# S02: Registration, Heartbeat & Discovery API

**Goal:** Implement the three core Edge Function endpoints: register, heartbeat, and discover — with full request validation, Ed25519 public key storage, and auto-offline detection
**Demo:** After this: curl can register an agent, send heartbeats, and discover by capability tag; auto-offline works after 90s

## Tasks
- [x] **T01: Implemented POST /register with token hashing, validation, and re-registration support** — 1. Create supabase/functions/_shared/supabase.ts — initialize Supabase admin client using service_role key from env\n2. Add input validation helper (validateRequired, validateCapabilities)\n3. Implement POST /oacp/register handler:\n   - Parse and validate RegisterRequest body\n   - Generate registry_token (crypto.randomUUID or similar)\n   - Hash registry_token before storage (SHA-256)\n   - Insert into agents table, return agent_id + raw registry_token\n   - Handle re-registration: if agent_id provided and token matches, update fields\n4. Wire handler into router in index.ts\n5. Test with curl examples
  - Estimate: 30min
  - Files: supabase/functions/oacp/index.ts, supabase/functions/_shared/supabase.ts, supabase/functions/_shared/validation.ts
  - Verify: Structural check: handler uses supabase client, validates input, inserts row, returns agent_id + token
- [x] **T02: Implemented auto-offline detection via Postgres function + cron Edge Function** — 1. Implement POST /oacp/heartbeat handler:\n   - Validate agent_id and registry_token from Authorization header\n   - Update agents.last_seen_at = now() and status = 'online'\n   - Return updated last_seen_at\n2. Create SQL migration for auto-offline function:\n   - pg_cron or Supabase scheduled function that runs every 30s\n   - Sets status = 'offline' for agents where last_seen_at < now() - interval '90 seconds'\n   - Only updates agents currently in 'online' or 'busy' status\n3. Wire heartbeat handler into router
  - Estimate: 25min
  - Files: supabase/functions/oacp/index.ts, supabase/migrations/20250331000002_auto_offline_function.sql
  - Verify: Structural check: heartbeat updates last_seen_at; auto-offline migration exists with interval logic
- [x] **T03: GET /discover endpoint with capability filtering, pagination, and token stripping already implemented** — 1. Implement GET /oacp/discover handler:\n   - Parse query params: capability, status, owner_handle, page, page_size\n   - Build Supabase query with filters\n   - Use capabilities @> ARRAY[capability] for GIN-indexed tag matching\n   - Paginate with default page_size=20\n   - Strip registry_token from results\n   - Return DiscoverResponse with agents, total, page, page_size\n2. Wire into router\n3. Test with various filter combinations
  - Estimate: 20min
  - Files: supabase/functions/oacp/index.ts
  - Verify: Structural check: handler queries with filters, strips sensitive fields, paginates
- [ ] **T04: Integration test script and final verification** — 1. Create test script (scripts/test-api.sh or similar) that:\n   - Calls /health and checks response\n   - Registers an agent and captures agent_id + token\n   - Sends heartbeat and verifies last_seen_at updated\n   - Registers a second agent with different capabilities\n   - Discovers by capability tag and verifies results\n   - Verifies re-registration works\n2. Verify all handlers compile (no syntax errors)\n3. Commit all S02 work
  - Estimate: 15min
  - Files: scripts/test-api.sh
  - Verify: Test script exists with all endpoint tests; all Edge Function files have valid structure
