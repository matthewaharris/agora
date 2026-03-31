---
id: S02
parent: M002
milestone: M002
provides:
  - SDK send() with signature signing
  - SDK on()/off() with Realtime subscription
  - SDK getMessages() for polling
  - Two-agent demo example
requires:
  - slice: S01
    provides: POST /messages/send endpoint and messages table
affects:
  - M003/S01
  - M003/S02
key_files:
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/crypto.ts
  - examples/two-agents.ts
key_decisions:
  - canonicalizeMessage identical between SDK and Edge Function
  - Lazy Supabase Realtime import
  - Wildcard '*' handler support
patterns_established:
  - Canonical message format for deterministic Ed25519 signing (SDK + server)
  - Event handler pattern with wildcard support
  - Lazy Supabase Realtime import with polling fallback
observability_surfaces:
  - [OACP] console.log for message send/receive with agent IDs
  - [OACP] Realtime subscription status logging
drill_down_paths:
  - .gsd/milestones/M002/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:17:53.286Z
blocker_discovered: false
---

# S02: SDK Messaging — send(), on(), Signature Verification

**Completed SDK messaging: send(), on(), getMessages() with Ed25519 signing and Realtime delivery**

## What Happened

Completed the SDK messaging layer: send() canonicalizes and signs messages with Ed25519 then POSTs to the registry. on() subscribes to Supabase Realtime for live incoming message delivery with type-specific and wildcard handlers. getMessages() provides authenticated polling for inbox/outbox. The two-agents.ts example implements the complete PRD Section 7 demo scenario end-to-end.

## Verification

tsc --noEmit: 0 errors. tsc build: clean. Git commit: 19 files. All methods present in agent.ts.

## Requirements Advanced

- REQ-AGENT-02 — SDK exposes agent.send() and agent.on() event-driven API
- REQ-AGENT-03 — SDK signs all outgoing messages and can verify incoming

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

Realtime subscription requires @supabase/supabase-js at runtime.

## Follow-ups

None.

## Files Created/Modified

- `packages/oacp-sdk/src/agent.ts` — Added send(), on(), off(), getMessages(), Realtime subscription
- `packages/oacp-sdk/src/crypto.ts` — Added canonicalizeMessage matching Edge Function
- `packages/oacp-sdk/src/index.ts` — Added canonicalizeMessage export
- `examples/two-agents.ts` — Full PRD Section 7 two-agent demo
- `README.md` — Added messaging section
