---
id: T01
parent: S02
milestone: M002
provides: []
requires: []
affects: []
key_files: ["packages/oacp-sdk/src/agent.ts", "packages/oacp-sdk/src/crypto.ts", "packages/oacp-sdk/src/index.ts"]
key_decisions: ["canonicalizeMessage in SDK matches Edge Function version exactly (sorted keys)", "Lazy Supabase Realtime import via require() — graceful fallback to polling if unavailable", "Wildcard '*' event handler for catching all message types", "dispatchMessage handles both type-specific and wildcard handlers"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc --noEmit passes with 0 errors. send, on, off, getMessages, canonicalizeMessage all present in source."
completed_at: 2026-03-31T21:16:31.883Z
blocker_discovered: false
---

# T01: Added send(), on(), off(), getMessages() to OACPAgent with Ed25519 signing and Realtime subscription

> Added send(), on(), off(), getMessages() to OACPAgent with Ed25519 signing and Realtime subscription

## What Happened
---
id: T01
parent: S02
milestone: M002
key_files:
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/crypto.ts
  - packages/oacp-sdk/src/index.ts
key_decisions:
  - canonicalizeMessage in SDK matches Edge Function version exactly (sorted keys)
  - Lazy Supabase Realtime import via require() — graceful fallback to polling if unavailable
  - Wildcard '*' event handler for catching all message types
  - dispatchMessage handles both type-specific and wildcard handlers
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:16:31.884Z
blocker_discovered: false
---

# T01: Added send(), on(), off(), getMessages() to OACPAgent with Ed25519 signing and Realtime subscription

**Added send(), on(), off(), getMessages() to OACPAgent with Ed25519 signing and Realtime subscription**

## What Happened

Extended OACPAgent with full messaging: send() canonicalizes message, signs with Ed25519, POSTs to /messages/send. getMessages() retrieves inbox/outbox with filters. on(type, handler) subscribes to Supabase Realtime for live message delivery, with wildcard support. off() unsubscribes. Realtime subscription filters by recipient_agent_id for this agent. Added canonicalizeMessage to crypto.ts matching the Edge Function implementation exactly. Build passes with zero TypeScript errors.

## Verification

tsc --noEmit passes with 0 errors. send, on, off, getMessages, canonicalizeMessage all present in source.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | pass - 0 errors | 6400ms |


## Deviations

Used require() for lazy Supabase Realtime import to avoid mandatory dependency at module load time.

## Known Issues

None.

## Files Created/Modified

- `packages/oacp-sdk/src/agent.ts`
- `packages/oacp-sdk/src/crypto.ts`
- `packages/oacp-sdk/src/index.ts`


## Deviations
Used require() for lazy Supabase Realtime import to avoid mandatory dependency at module load time.

## Known Issues
None.
