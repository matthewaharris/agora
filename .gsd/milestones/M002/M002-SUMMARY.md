---
id: M002
title: "Messaging — Message Envelope, Realtime Delivery & SDK Messaging API"
status: complete
completed_at: 2026-03-31T21:18:36.728Z
key_decisions:
  - Canonical message format with sorted JSON keys for deterministic Ed25519 signing
  - GET /messages endpoint for polling fallback alongside Realtime
  - Ed25519 via esm.sh for Deno Edge Functions
  - Lazy Supabase Realtime import in SDK for graceful degradation
key_files:
  - supabase/migrations/20250331000003_create_messages_table.sql
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/crypto.ts
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/crypto.ts
  - examples/two-agents.ts
  - scripts/test-api.sh
lessons_learned:
  - Canonical message format must be byte-identical between signing (SDK) and verification (server)
  - esm.sh works well for npm imports in Deno Edge Functions
  - Lazy require() for optional Supabase Realtime avoids hard dependency
---

# M002: Messaging — Message Envelope, Realtime Delivery & SDK Messaging API

**Completed OACP messaging layer: signed message exchange via Supabase message bus with event-driven SDK**

## What Happened

Built the complete OACP messaging layer across 2 slices and 5 tasks. S01 created the messages table and implemented POST /messages/send with Ed25519 signature verification plus GET /messages for inbox/outbox. S02 extended the SDK with send(), on()/off(), and getMessages(). The two-agents.ts example implements the full PRD Section 7 demo scenario. SDK compiles with zero type errors.

## Success Criteria Results

All 6 success criteria met:\n1. ✅ Messages table with Realtime\n2. ✅ Send endpoint validates and verifies signatures\n3. ✅ Messages persisted for audit\n4. ✅ SDK send() composes and signs\n5. ✅ SDK on() receives via Realtime\n6. ✅ Two agents exchange complete task lifecycle

## Definition of Done Results

- ✅ Messages table created with Realtime enabled\n- ✅ POST /messages/send validates, verifies signatures, routes messages\n- ✅ SDK agent.send() and agent.on() work end-to-end\n- ✅ Message signatures verified on send and receive\n- ✅ All message types (task_request, task_ack, task_result, task_error) handled\n- ✅ Two-agent example demonstrates full message exchange

## Requirement Outcomes

- REQ-MSG-01 through REQ-MSG-05: All implemented\n- REQ-AGENT-02: Validated — agent.send() + agent.on() API complete\n- REQ-AGENT-03: Validated — Ed25519 signing on all messages

## Deviations

None.

## Follow-ups

None.
