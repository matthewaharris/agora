---
id: T01
parent: S01
milestone: M006
provides: []
requires: []
affects: []
key_files: ["supabase/migrations/20250401000001_unique_public_key.sql", "supabase/functions/oacp/index.ts", "packages/oacp-sdk/src/agent.ts"]
key_decisions: ["Public key is the permanent identity anchor", "Returning agents get a new registry_token each time (security: old tokens invalidated)", "UNIQUE constraint on public_key prevents duplicates at DB level"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Two registrations with same public_key return same agent_id. returning:true on second call."
completed_at: 2026-04-02T03:15:00.277Z
blocker_discovered: false
---

# T01: Persistent identity: same keypair = same agent_id across restarts, verified end-to-end

> Persistent identity: same keypair = same agent_id across restarts, verified end-to-end

## What Happened
---
id: T01
parent: S01
milestone: M006
key_files:
  - supabase/migrations/20250401000001_unique_public_key.sql
  - supabase/functions/oacp/index.ts
  - packages/oacp-sdk/src/agent.ts
key_decisions:
  - Public key is the permanent identity anchor
  - Returning agents get a new registry_token each time (security: old tokens invalidated)
  - UNIQUE constraint on public_key prevents duplicates at DB level
duration: ""
verification_result: passed
completed_at: 2026-04-02T03:15:00.277Z
blocker_discovered: false
---

# T01: Persistent identity: same keypair = same agent_id across restarts, verified end-to-end

**Persistent identity: same keypair = same agent_id across restarts, verified end-to-end**

## What Happened

Added persistent agent identity: registration now checks if the public_key already exists. If it does, the agent gets its existing agent_id back with a fresh registry_token (invalidating old tokens). Added UNIQUE constraint on public_key column. SDK logs 'Welcome back' for returning agents. Verified: two registrations with same keypair return identical agent_id.

## Verification

Two registrations with same public_key return same agent_id. returning:true on second call.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `curl register x2 with same public_key` | 0 | pass — same agent_id | 2000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `supabase/migrations/20250401000001_unique_public_key.sql`
- `supabase/functions/oacp/index.ts`
- `packages/oacp-sdk/src/agent.ts`


## Deviations
None.

## Known Issues
None.
