---
id: T03
parent: S01
milestone: M004
provides: []
requires: []
affects: []
key_files: ["agents/research-agent/index.ts", "agents/extraction-agent/index.ts", "packages/oacp-sdk/src/agent.ts"]
key_decisions: ["Research agent uses registerAction() instead of raw on()", "Extraction agent includes action: 'summarize-text' in payload", "Trust pipeline runs automatically before action handlers"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Both agents run successfully. Trust check passes. Task result returned. Exit code 0."
completed_at: 2026-04-01T04:50:24.276Z
blocker_discovered: false
---

# T03: Updated agents with action specs, fixed Realtime timing, verified trust pipeline end-to-end

> Updated agents with action specs, fixed Realtime timing, verified trust pipeline end-to-end

## What Happened
---
id: T03
parent: S01
milestone: M004
key_files:
  - agents/research-agent/index.ts
  - agents/extraction-agent/index.ts
  - packages/oacp-sdk/src/agent.ts
key_decisions:
  - Research agent uses registerAction() instead of raw on()
  - Extraction agent includes action: 'summarize-text' in payload
  - Trust pipeline runs automatically before action handlers
duration: ""
verification_result: passed
completed_at: 2026-04-01T04:50:24.277Z
blocker_discovered: false
---

# T03: Updated agents with action specs, fixed Realtime timing, verified trust pipeline end-to-end

**Updated agents with action specs, fixed Realtime timing, verified trust pipeline end-to-end**

## What Happened

Updated both reference agents to use the trust model. Research agent declares a 'summarize-text' action spec with input schema validation. Extraction agent includes action field in its payload. Fixed a critical Realtime subscription timing bug where subscription was attempted before register() set the agentId. Verified end-to-end: trust check passes, action executes, result returned. Pushed to GitHub.

## Verification

Both agents run successfully. Trust check passes. Task result returned. Exit code 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `research-agent + extraction-agent live test` | 0 | pass — trust check passed, task completed | 10000ms |


## Deviations

Had to fix Realtime subscription timing — deferred subscription start until after register() completes.

## Known Issues

Extraction agent's Realtime has a harmless warning about adding callbacks after subscribe() — doesn't affect functionality since polling fallback works.

## Files Created/Modified

- `agents/research-agent/index.ts`
- `agents/extraction-agent/index.ts`
- `packages/oacp-sdk/src/agent.ts`


## Deviations
Had to fix Realtime subscription timing — deferred subscription start until after register() completes.

## Known Issues
Extraction agent's Realtime has a harmless warning about adding callbacks after subscribe() — doesn't affect functionality since polling fallback works.
