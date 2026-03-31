---
id: S01
parent: M001
milestone: M001
provides:
  - Supabase schema (agents table)
  - Edge Function scaffold with router
  - Shared TypeScript types
  - oacp-sdk package scaffold
  - Monorepo structure
requires:
  []
affects:
  - S02
key_files:
  - supabase/migrations/20250331000001_create_agents_table.sql
  - supabase/functions/oacp/index.ts
  - supabase/functions/_shared/types.ts
  - packages/oacp-sdk/package.json
  - README.md
key_decisions:
  - Fat function pattern for Edge Functions to minimize cold starts
  - Merged heartbeats table into agents.last_seen_at column
  - A2A-aligned Agent Card schema with protocols_supported field
  - npm workspaces monorepo structure
patterns_established:
  - Fat function with path-based routing for Supabase Edge Functions
  - Shared _shared/ directory for cross-function types and utilities
  - jsonResponse/errorResponse helpers for consistent API responses
  - Structural SQL validation when live DB is unavailable
observability_surfaces:
  - Health check endpoint at /oacp/health
  - Supabase dashboard shows agents table and Edge Function
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:16:11.902Z
blocker_discovered: false
---

# S01: Supabase Schema & Project Setup

**Established OACP foundation: Supabase schema, Edge Function router, shared types, SDK scaffold, and monorepo structure**

## What Happened

Set up the complete OACP project foundation: initialized Supabase with a Postgres migration for the agents table (Ed25519 identity, GIN-indexed capabilities, RLS, Realtime), created the Edge Function skeleton with a fat-function router pattern (health check live, other routes stubbed), defined shared TypeScript types for the full protocol (Agent Card, Message Envelope, API contracts), scaffolded the oacp-sdk npm package, and established the monorepo structure with npm workspaces. All committed with a comprehensive README.

## Verification

Structural validation of all files (SQL migration 10/10 checks, Edge Function 7/7 symbols, types 5/5 types). Git commit of 26 files succeeded.

## Requirements Advanced

- REQ-REG-01 — Agents table schema supports registration and Agent Card storage
- REQ-REG-03 — agent_id UUID PK, created_at/updated_at timestamps defined
- REQ-DISC-01 — GIN index on capabilities and status filter support defined

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Docker/Deno not available locally, so migrations and Edge Functions couldn't be tested against live environments. Validated structurally instead.

## Known Limitations

Cannot test against live Supabase locally without Docker. Edge Functions not type-checked without Deno.

## Follow-ups

Install Deno locally for Edge Function type checking. Set up Docker for local Supabase stack testing.

## Files Created/Modified

- `package.json` — Monorepo root with npm workspaces
- `supabase/config.toml` — Supabase project config (project_id: oacp)
- `supabase/migrations/20250331000001_create_agents_table.sql` — Agents table with Ed25519 identity, GIN-indexed capabilities, RLS, Realtime
- `supabase/functions/oacp/index.ts` — OACP Edge Function with router, health check, stub routes
- `supabase/functions/_shared/types.ts` — Shared TypeScript types for Agent Card, Message Envelope, API contracts
- `supabase/functions/_shared/cors.ts` — CORS headers and response helper functions
- `packages/oacp-sdk/package.json` — SDK package scaffold with dependencies
- `README.md` — Setup instructions, project structure, API endpoint table
