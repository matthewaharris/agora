---
id: T01
parent: S02
milestone: M006
provides: []
requires: []
affects: []
key_files: ["supabase/migrations/20250401000002_rate_limiting.sql", "supabase/functions/oacp/index.ts"]
key_decisions: ["Sliding window via Postgres function with probabilistic cleanup", "Fail-open on rate limit errors (don't block legitimate traffic)", "Per-endpoint limits: register=10/min, heartbeat=5/min, send=30/min, discover=60/min", "429 response with Retry-After header"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Migration and Edge Function deployed successfully."
completed_at: 2026-04-02T03:18:01.228Z
blocker_discovered: false
---

# T01: Sliding window rate limiting on all endpoints with 429 responses and Retry-After headers

> Sliding window rate limiting on all endpoints with 429 responses and Retry-After headers

## What Happened
---
id: T01
parent: S02
milestone: M006
key_files:
  - supabase/migrations/20250401000002_rate_limiting.sql
  - supabase/functions/oacp/index.ts
key_decisions:
  - Sliding window via Postgres function with probabilistic cleanup
  - Fail-open on rate limit errors (don't block legitimate traffic)
  - Per-endpoint limits: register=10/min, heartbeat=5/min, send=30/min, discover=60/min
  - 429 response with Retry-After header
duration: ""
verification_result: passed
completed_at: 2026-04-02T03:18:01.228Z
blocker_discovered: false
---

# T01: Sliding window rate limiting on all endpoints with 429 responses and Retry-After headers

**Sliding window rate limiting on all endpoints with 429 responses and Retry-After headers**

## What Happened

Built sliding window rate limiting via a Postgres function. Each endpoint has configurable limits. Rate limit checks happen in the main handler before routing. Returns 429 with Retry-After header when exceeded. Fails open on errors to avoid blocking legitimate traffic. Probabilistic cleanup keeps the rate_limits table small.

## Verification

Migration and Edge Function deployed successfully.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `supabase db push + functions deploy` | 0 | pass | 10000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `supabase/migrations/20250401000002_rate_limiting.sql`
- `supabase/functions/oacp/index.ts`


## Deviations
None.

## Known Issues
None.
