---
id: T02
parent: S01
milestone: M004
provides: []
requires: []
affects: []
key_files: ["packages/oacp-sdk/src/agent.ts"]
key_decisions: ["registerAction() auto-sends task_result if handler returns an object", "Trust pipeline: sender check → action match → payload validation → execute", "Action specs included in Agent Card metadata on registration", "Rejected tasks get typed task_error with specific error codes (unauthorized, unknown_action, invalid_payload, execution_error)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc --noEmit and tsc build both pass with 0 errors."
completed_at: 2026-04-01T04:34:57.646Z
blocker_discovered: false
---

# T02: Integrated trust pipeline into OACPAgent: registerAction() with sender check, action matching, payload validation

> Integrated trust pipeline into OACPAgent: registerAction() with sender check, action matching, payload validation

## What Happened
---
id: T02
parent: S01
milestone: M004
key_files:
  - packages/oacp-sdk/src/agent.ts
key_decisions:
  - registerAction() auto-sends task_result if handler returns an object
  - Trust pipeline: sender check → action match → payload validation → execute
  - Action specs included in Agent Card metadata on registration
  - Rejected tasks get typed task_error with specific error codes (unauthorized, unknown_action, invalid_payload, execution_error)
duration: ""
verification_result: passed
completed_at: 2026-04-01T04:34:57.647Z
blocker_discovered: false
---

# T02: Integrated trust pipeline into OACPAgent: registerAction() with sender check, action matching, payload validation

**Integrated trust pipeline into OACPAgent: registerAction() with sender check, action matching, payload validation**

## What Happened

Integrated the trust model into OACPAgent. registerAction() accepts an ActionSpec and handler, sets up a trust pipeline on task_request messages. The pipeline runs: 1) sender allowlist check, 2) action matching (by payload.action field or single-action default), 3) payload schema validation, 4) handler execution with auto task_result sending. Each rejection sends a typed task_error back. Action specs are included in Agent Card metadata during registration so discovering agents can see what actions are available.

## Verification

tsc --noEmit and tsc build both pass with 0 errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | pass | 4000ms |
| 2 | `npx tsc` | 0 | pass | 4000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `packages/oacp-sdk/src/agent.ts`


## Deviations
None.

## Known Issues
None.
