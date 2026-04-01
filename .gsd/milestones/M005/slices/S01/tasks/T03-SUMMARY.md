---
id: T03
parent: S01
milestone: M005
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "curl: POST /register returns agent_id; GET /balance returns balance:1000"
completed_at: 2026-04-01T16:09:42.943Z
blocker_discovered: false
---

# T03: Deployed and verified: registration grants 1000 tokens, balance API works

> Deployed and verified: registration grants 1000 tokens, balance API works

## What Happened
---
id: T03
parent: S01
milestone: M005
key_files:
  - (none)
key_decisions:
  - (none)
duration: ""
verification_result: passed
completed_at: 2026-04-01T16:09:42.943Z
blocker_discovered: false
---

# T03: Deployed and verified: registration grants 1000 tokens, balance API works

**Deployed and verified: registration grants 1000 tokens, balance API works**

## What Happened

Deployed Edge Function and verified end-to-end: new agent registration triggers starting balance of 1000 tokens, GET /balance returns correct amount.

## Verification

curl: POST /register returns agent_id; GET /balance returns balance:1000

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `curl POST /register + GET /balance` | 0 | pass — 1000 tokens granted | 2000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

None.


## Deviations
None.

## Known Issues
None.
