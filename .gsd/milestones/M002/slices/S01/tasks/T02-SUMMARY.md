---
id: T02
parent: S01
milestone: M002
provides: []
requires: []
affects: []
key_files: ["supabase/functions/oacp/index.ts", "supabase/functions/_shared/crypto.ts"]
key_decisions: ["Canonical message format for deterministic signing (sorted JSON keys, exclude signature)", "Ed25519 verification via @noble/ed25519 imported from esm.sh for Deno compatibility", "GET /messages supports inbox/outbox direction, correlation_id filter, and since timestamp filter", "Sender authenticated via Bearer token; recipient existence verified before insert"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "10/10 structural checks pass: handlers, crypto imports, sender/recipient validation, correlation_id, 201 status, messages table queries, inbox/outbox direction."
completed_at: 2026-03-31T21:12:57.118Z
blocker_discovered: false
---

# T02: Implemented POST /messages/send with Ed25519 signature verification and GET /messages for inbox/outbox retrieval

> Implemented POST /messages/send with Ed25519 signature verification and GET /messages for inbox/outbox retrieval

## What Happened
---
id: T02
parent: S01
milestone: M002
key_files:
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/crypto.ts
key_decisions:
  - Canonical message format for deterministic signing (sorted JSON keys, exclude signature)
  - Ed25519 verification via @noble/ed25519 imported from esm.sh for Deno compatibility
  - GET /messages supports inbox/outbox direction, correlation_id filter, and since timestamp filter
  - Sender authenticated via Bearer token; recipient existence verified before insert
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:12:57.118Z
blocker_discovered: false
---

# T02: Implemented POST /messages/send with Ed25519 signature verification and GET /messages for inbox/outbox retrieval

**Implemented POST /messages/send with Ed25519 signature verification and GET /messages for inbox/outbox retrieval**

## What Happened

Built the POST /messages/send handler with full validation: parses envelope, authenticates sender via Bearer token, looks up sender's public key, canonicalizes message content, verifies Ed25519 signature, checks recipient exists, then inserts into messages table. Also built GET /messages endpoint for inbox/outbox retrieval with filters (message_type, correlation_id, since timestamp) and pagination. Created shared crypto module with canonicalizeMessage and verifyMessageSignature functions using @noble/ed25519 via esm.sh for Deno.

## Verification

10/10 structural checks pass: handlers, crypto imports, sender/recipient validation, correlation_id, 201 status, messages table queries, inbox/outbox direction.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `structural check + grep on index.ts` | 0 | pass - all elements present | 100ms |


## Deviations

Added GET /messages endpoint (inbox/outbox) in addition to POST /messages/send — needed for agents to poll for messages as a complement to Realtime.

## Known Issues

None.

## Files Created/Modified

- `supabase/functions/oacp/index.ts`
- `supabase/functions/_shared/crypto.ts`


## Deviations
Added GET /messages endpoint (inbox/outbox) in addition to POST /messages/send — needed for agents to poll for messages as a complement to Realtime.

## Known Issues
None.
