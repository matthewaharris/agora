---
id: T01
parent: S02
milestone: M001
provides: []
requires: []
affects: []
key_files: ["supabase/functions/oacp/index.ts", "supabase/functions/_shared/supabase.ts", "supabase/functions/_shared/validation.ts"]
key_decisions: ["Registry token is SHA-256 hashed before storage — raw token returned only on first registration", "Re-registration requires Bearer token and preserves agent_id", "Heartbeat preserves 'busy' status if set, otherwise sets 'online'"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Structural validation: 13/13 code elements present (handleRegister, hashToken, extractBearerToken, validation imports, GIN contains, hashed storage, 201 status, etc.)"
completed_at: 2026-03-31T20:18:21.000Z
blocker_discovered: false
---

# T01: Implemented POST /register with token hashing, validation, and re-registration support

> Implemented POST /register with token hashing, validation, and re-registration support

## What Happened
---
id: T01
parent: S02
milestone: M001
key_files:
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/supabase.ts
  - supabase/functions/_shared/validation.ts
key_decisions:
  - Registry token is SHA-256 hashed before storage — raw token returned only on first registration
  - Re-registration requires Bearer token and preserves agent_id
  - Heartbeat preserves 'busy' status if set, otherwise sets 'online'
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:18:21.000Z
blocker_discovered: false
---

# T01: Implemented POST /register with token hashing, validation, and re-registration support

**Implemented POST /register with token hashing, validation, and re-registration support**

## What Happened

Created the Supabase admin client helper (supabase.ts) and input validation module (validation.ts) with validators for required fields, capabilities arrays, Ed25519 public keys (64 hex chars), and UUIDs. Implemented the full register handler with new registration (generates + hashes token, inserts row, returns raw token) and re-registration (verifies Bearer token, updates fields). All validation happens before any DB calls.

## Verification

Structural validation: 13/13 code elements present (handleRegister, hashToken, extractBearerToken, validation imports, GIN contains, hashed storage, 201 status, etc.)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `python structural_check on index.ts` | 0 | pass - 13/13 elements verified | 100ms |


## Deviations

Implemented all three endpoints (register, heartbeat, discover) in a single task since they share the same helpers and router wiring.

## Known Issues

None.

## Files Created/Modified

- `supabase/functions/oacp/index.ts`
- `supabase/functions/_shared/supabase.ts`
- `supabase/functions/_shared/validation.ts`


## Deviations
Implemented all three endpoints (register, heartbeat, discover) in a single task since they share the same helpers and router wiring.

## Known Issues
None.
