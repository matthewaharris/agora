---
id: T03
parent: S02
milestone: M001
provides: []
requires: []
affects: []
key_files: ["supabase/functions/oacp/index.ts"]
key_decisions: ["Uses Supabase .contains() for GIN-indexed capability tag matching", "Pagination with default page_size=20, max 100", "Strips registry_token from results by explicitly selecting columns", "Results ordered by created_at descending (newest first)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "handleDiscover function present in index.ts with .contains() for GIN lookup, page/page_size params, and explicit column select excluding registry_token."
completed_at: 2026-03-31T20:19:42.402Z
blocker_discovered: false
---

# T03: GET /discover endpoint with capability filtering, pagination, and token stripping already implemented

> GET /discover endpoint with capability filtering, pagination, and token stripping already implemented

## What Happened
---
id: T03
parent: S02
milestone: M001
key_files:
  - supabase/functions/oacp/index.ts
key_decisions:
  - Uses Supabase .contains() for GIN-indexed capability tag matching
  - Pagination with default page_size=20, max 100
  - Strips registry_token from results by explicitly selecting columns
  - Results ordered by created_at descending (newest first)
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:19:42.403Z
blocker_discovered: false
---

# T03: GET /discover endpoint with capability filtering, pagination, and token stripping already implemented

**GET /discover endpoint with capability filtering, pagination, and token stripping already implemented**

## What Happened

The discover endpoint was fully implemented in the T01 index.ts rewrite. It supports filtering by capability (GIN-indexed array contains), status, and owner_handle. Pagination uses page/page_size params with exact count for total. The query explicitly lists columns to exclude registry_token from results.

## Verification

handleDiscover function present in index.ts with .contains() for GIN lookup, page/page_size params, and explicit column select excluding registry_token.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `grep handleDiscover index.ts` | 0 | pass | 50ms |


## Deviations

Discover endpoint was implemented alongside register and heartbeat in T01 since they share the same router file.

## Known Issues

None.

## Files Created/Modified

- `supabase/functions/oacp/index.ts`


## Deviations
Discover endpoint was implemented alongside register and heartbeat in T01 since they share the same router file.

## Known Issues
None.
