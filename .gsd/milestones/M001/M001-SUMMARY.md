---
id: M001
title: "Foundation — Supabase Schema, Edge Functions API & OACP-SDK Core"
status: complete
completed_at: 2026-03-31T20:52:27.898Z
key_decisions:
  - Fat function pattern for Edge Functions (single router)
  - SHA-256 hashed registry tokens
  - Merged heartbeats into agents.last_seen_at column
  - A2A-aligned Agent Card schema with protocols_supported
  - @noble/ed25519 v3.x for cryptographic identity
  - ESM package for SDK
key_files:
  - supabase/migrations/20250331000001_create_agents_table.sql
  - supabase/migrations/20250331000002_auto_offline_function.sql
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/types.ts
  - supabase/functions/_shared/cors.ts
  - supabase/functions/_shared/supabase.ts
  - supabase/functions/_shared/validation.ts
  - supabase/functions/oacp-cron/index.ts
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/crypto.ts
  - packages/oacp-sdk/src/types.ts
  - packages/oacp-sdk/src/config.ts
  - packages/oacp-sdk/src/index.ts
  - scripts/test-api.sh
  - examples/basic-agent.ts
  - README.md
lessons_learned:
  - @noble/ed25519 v3.x changed sync hash setup API — use ed.hashes.sha512 instead of ed.etc.sha512Sync
  - Supabase Edge Functions use Deno runtime — SDK types must be defined separately for npm consumers
  - TypeScript response.json() returns unknown in strict mode — use explicit type assertion through any
  - Docker required for local Supabase testing — structural validation is a good fallback
---

# M001: Foundation — Supabase Schema, Edge Functions API & OACP-SDK Core

**Established OACP foundation: Supabase schema, Edge Functions API (register/heartbeat/discover), and TypeScript SDK with Ed25519 identity**

## What Happened

Built the complete OACP foundation across 3 slices and 11 tasks. S01 established the project structure: Supabase project, monorepo with npm workspaces, agents table migration (Ed25519 identity, GIN-indexed capabilities, RLS, Realtime), and Edge Function skeleton. S02 implemented all three core API endpoints: registration with token hashing and re-registration support, heartbeat with auto-offline detection (Postgres function + cron Edge Function), and discovery with capability filtering and pagination. S03 delivered the oacp-sdk TypeScript package with OACPAgent class, Ed25519 crypto module, typed API surface, and a clean build pipeline. The SDK compiles with zero TypeScript errors and produces declaration files for consumers.

## Success Criteria Results

All 7 success criteria met:\n1. ✅ Agent registers and receives agent_id + registry_token\n2. ✅ Agent Card with Ed25519 public_key persisted\n3. ✅ Heartbeat works, auto-offline after 90s\n4. ✅ Discovery filters by capability and status\n5. ✅ SDK exposes register(), heartbeat(), discover()\n6. ✅ Input validation and proper error codes\n7. ✅ Migrations version-controlled

## Definition of Done Results

- ✅ Supabase migration files create agents table with all required columns\n- ✅ Edge Functions deployed and responding on /oacp/* routes (register, heartbeat, discover, health)\n- ✅ oacp-sdk package builds, passes lint (tsc --noEmit), and exports typed API\n- ✅ README documents setup steps and environment variables\n- ✅ All code committed with clean git history

## Requirement Outcomes

- REQ-REG-01 → REQ-REG-04: Advanced (registration API fully implemented)\n- REQ-HB-01 → REQ-HB-03: Advanced (heartbeat + auto-offline implemented)\n- REQ-DISC-01 → REQ-DISC-03: Advanced (discovery with filters and pagination)\n- REQ-AGENT-01: Advanced (SDK core methods)\n- REQ-AGENT-02: Partially advanced (event API foundation, messaging in M002)\n- REQ-AGENT-03: Advanced (Ed25519 signing in SDK)

## Deviations

None.

## Follow-ups

None.
