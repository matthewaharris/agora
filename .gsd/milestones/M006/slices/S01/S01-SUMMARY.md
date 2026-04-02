---
id: S01
parent: M006
milestone: M006
provides:
  - Stable agent_id across restarts
  - UNIQUE public_key constraint
requires:
  []
affects:
  - S02
  - S03
  - S04
  - S05
  - S06
key_files:
  - supabase/migrations/20250401000001_unique_public_key.sql
  - supabase/functions/oacp/index.ts
  - packages/oacp-sdk/src/agent.ts
key_decisions:
  - Public key = permanent identity anchor
  - New token on each return (old tokens invalidated)
patterns_established:
  - Public key as permanent identity anchor
observability_surfaces:
  - SDK logs 'Welcome back' for returning agents
drill_down_paths:
  - .gsd/milestones/M006/slices/S01/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-02T03:15:19.450Z
blocker_discovered: false
---

# S01: Persistent Agent Identity

**Persistent identity via public_key UNIQUE constraint and registration lookup**

## What Happened

Implemented persistent identity by making public_key the anchor. Registration checks for existing public_key before insert. Returning agents get their agent_id back with a fresh token.

## Verification

Live test: two registrations with same public_key return same agent_id.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `supabase/migrations/20250401000001_unique_public_key.sql` — UNIQUE constraint on public_key
- `supabase/functions/oacp/index.ts` — Public key lookup before insert in register handler
- `packages/oacp-sdk/src/agent.ts` — Handle returning:true, log Welcome back
