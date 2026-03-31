---
id: T02
parent: S02
milestone: M001
provides: []
requires: []
affects: []
key_files: ["supabase/migrations/20250331000002_auto_offline_function.sql", "supabase/functions/oacp-cron/index.ts"]
key_decisions: ["Auto-offline via Postgres function (oacp_mark_offline_agents) callable by pg_cron or Edge Function", "Separate oacp-cron Edge Function for free-tier Supabase without pg_cron", "90-second timeout as specified in PRD REQ-HB-02", "Only updates agents currently 'online' or 'busy' (not already 'offline')"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Migration file contains oacp_mark_offline_agents function with 90-second interval check. Cron function calls it via Supabase RPC."
completed_at: 2026-03-31T20:18:58.615Z
blocker_discovered: false
---

# T02: Implemented auto-offline detection via Postgres function + cron Edge Function

> Implemented auto-offline detection via Postgres function + cron Edge Function

## What Happened
---
id: T02
parent: S02
milestone: M001
key_files:
  - supabase/migrations/20250331000002_auto_offline_function.sql
  - supabase/functions/oacp-cron/index.ts
key_decisions:
  - Auto-offline via Postgres function (oacp_mark_offline_agents) callable by pg_cron or Edge Function
  - Separate oacp-cron Edge Function for free-tier Supabase without pg_cron
  - 90-second timeout as specified in PRD REQ-HB-02
  - Only updates agents currently 'online' or 'busy' (not already 'offline')
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:18:58.615Z
blocker_discovered: false
---

# T02: Implemented auto-offline detection via Postgres function + cron Edge Function

**Implemented auto-offline detection via Postgres function + cron Edge Function**

## What Happened

Created the auto-offline detection system: a Postgres function (oacp_mark_offline_agents) that marks agents as offline if their last_seen_at exceeds 90 seconds, plus a lightweight oacp-cron Edge Function that calls it. The heartbeat handler was already implemented in T01's index.ts rewrite. The Postgres function uses SECURITY DEFINER and returns the count of affected agents for observability.

## Verification

Migration file contains oacp_mark_offline_agents function with 90-second interval check. Cron function calls it via Supabase RPC.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `grep '90 seconds' supabase/migrations/20250331000002_auto_offline_function.sql` | 0 | pass | 50ms |


## Deviations

Added a separate oacp-cron Edge Function as an alternative to pg_cron for free tier.

## Known Issues

pg_cron not available on Supabase free tier. External cron (Render, GitHub Actions) or manual calls needed for auto-offline on free tier.

## Files Created/Modified

- `supabase/migrations/20250331000002_auto_offline_function.sql`
- `supabase/functions/oacp-cron/index.ts`


## Deviations
Added a separate oacp-cron Edge Function as an alternative to pg_cron for free tier.

## Known Issues
pg_cron not available on Supabase free tier. External cron (Render, GitHub Actions) or manual calls needed for auto-offline on free tier.
