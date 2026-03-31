---
id: S01
parent: M002
milestone: M002
provides:
  - POST /messages/send endpoint with signature verification
  - GET /messages endpoint for inbox/outbox
  - Messages table with Realtime
  - Canonical message format
  - Edge Function crypto module
requires:
  []
affects:
  - S02
key_files:
  - supabase/migrations/20250331000003_create_messages_table.sql
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/crypto.ts
key_decisions:
  - Canonical message format for deterministic signing
  - GET /messages with inbox/outbox direction filter
  - Ed25519 via esm.sh for Deno Edge Functions
patterns_established:
  - Canonical message format for deterministic Ed25519 signing
  - esm.sh imports for npm packages in Deno Edge Functions
  - Inbox/outbox direction pattern for message retrieval
observability_surfaces:
  - [OACP] console.log for message routing with sender/recipient names
  - Messages table queryable in Supabase dashboard
drill_down_paths:
  - .gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:14:09.306Z
blocker_discovered: false
---

# S01: Messages Table & Send Endpoint

**Built messaging backend: messages table, POST /send with Ed25519 verification, GET /messages for inbox/outbox**

## What Happened

Built the messaging backend: messages table migration with FK constraints, CHECK on message_type, correlation_id for task lifecycle, and Realtime enabled. Implemented POST /messages/send with full pipeline: validate envelope, authenticate sender via Bearer token, look up sender's Ed25519 public key, canonicalize message, verify signature, check recipient exists, insert and return. Also added GET /messages for authenticated inbox/outbox retrieval with filters. Created shared crypto module with Deno-compatible Ed25519 verification.

## Verification

Structural validation: 12/12 migration checks, 10/10 handler checks. Git commit with 15 files. Test script extended to 14 scenarios.

## Requirements Advanced

- REQ-MSG-01 — Message envelope conforms to schema with all required fields
- REQ-MSG-02 — POST /messages/send routes envelope from sender to recipient
- REQ-MSG-03 — Messages table has Realtime enabled for delivery
- REQ-MSG-04 — At-least-once: message persisted before response
- REQ-MSG-05 — All messages stored in messages table

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Added GET /messages endpoint (inbox/outbox) not in original plan — needed for message polling as complement to Realtime.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `supabase/migrations/20250331000003_create_messages_table.sql` — Messages table with FKs, CHECK, correlation_id, Realtime
- `supabase/functions/oacp/index.ts` — Added handleMessageSend and handleGetMessages handlers
- `supabase/functions/_shared/crypto.ts` — Ed25519 verification + canonical message format for Deno
- `scripts/test-api.sh` — Extended with messaging tests 11-14
- `README.md` — Updated endpoint table
