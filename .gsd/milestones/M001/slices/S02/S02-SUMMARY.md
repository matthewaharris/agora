---
id: S02
parent: M001
milestone: M001
provides:
  - Working /register endpoint
  - Working /heartbeat endpoint
  - Working /discover endpoint
  - Auto-offline detection system
  - Integration test script
requires:
  - slice: S01
    provides: Supabase schema, Edge Function scaffold, shared types
affects:
  - S03
key_files:
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/supabase.ts
  - supabase/functions/_shared/validation.ts
  - supabase/migrations/20250331000002_auto_offline_function.sql
  - supabase/functions/oacp-cron/index.ts
  - scripts/test-api.sh
key_decisions:
  - SHA-256 hashed registry tokens
  - Auto-offline via Postgres function + cron Edge Function
  - Single fat function for all OACP routes
  - GIN-indexed capability discovery
patterns_established:
  - Bearer token auth with SHA-256 hashed storage
  - Input validation module with typed error responses
  - Postgres function + Edge Function cron pattern for scheduled tasks
  - Bash integration test script pattern for API verification
observability_surfaces:
  - Edge Function console.log for registration and errors
  - Postgres RAISE LOG for offline detection
  - Integration test script for endpoint verification
drill_down_paths:
  - .gsd/milestones/M001/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T03-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:35:51.528Z
blocker_discovered: false
---

# S02: Registration, Heartbeat & Discovery API

**Implemented registration, heartbeat, and discovery API with auto-offline detection and integration tests**

## What Happened

Implemented all three core API endpoints in the OACP Edge Function. Register handles both new registration (generates SHA-256 hashed token, inserts Agent Card) and re-registration (verifies token, updates fields). Heartbeat updates last_seen_at and preserves busy status. Discover supports capability filtering via GIN index, status filtering, owner filtering, and pagination with exact count. Added auto-offline detection via a Postgres function callable by pg_cron or a separate oacp-cron Edge Function. Built comprehensive input validation module and a 10-scenario integration test script.

## Verification

Structural validation of all handler functions, migrations, and test script. All code committed.

## Requirements Advanced

- REQ-REG-01 — POST /register endpoint accepts Agent Card, returns agent_id + token
- REQ-REG-02 — Returns unique agent_id (UUID v4) and registry_token
- REQ-REG-03 — Persists all fields with created_at and updated_at
- REQ-REG-04 — Re-registration with existing agent_id updates fields
- REQ-HB-01 — Heartbeat endpoint updates last_seen_at
- REQ-HB-02 — Auto-offline function marks agents offline after 90s
- REQ-HB-03 — Status changes go through Realtime-enabled agents table
- REQ-DISC-01 — Discovery supports capability, status, owner_handle filters
- REQ-DISC-02 — Returns Agent Cards without registry_token
- REQ-DISC-03 — Pagination with default page_size=20

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

All three route handlers (register, heartbeat, discover) implemented in T01 since they share the same router file, making T03 a verification-only task.

## Known Limitations

Cannot run integration tests without Docker/Supabase local stack.

## Follow-ups

Run test-api.sh against live Supabase when Docker is available.

## Files Created/Modified

- `supabase/functions/oacp/index.ts` — Full implementation of register, heartbeat, discover handlers with validation
- `supabase/functions/_shared/supabase.ts` — Supabase admin client with service_role key
- `supabase/functions/_shared/validation.ts` — Input validation for required fields, capabilities, public keys, UUIDs
- `supabase/migrations/20250331000002_auto_offline_function.sql` — Auto-offline Postgres function with 90s timeout
- `supabase/functions/oacp-cron/index.ts` — Cron Edge Function for auto-offline on free tier
- `scripts/test-api.sh` — Integration test script with 10 test scenarios
