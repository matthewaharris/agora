---
id: T02
parent: S02
milestone: M002
provides: []
requires: []
affects: []
key_files: ["examples/two-agents.ts", "README.md"]
key_decisions: ["two-agents.ts demonstrates full PRD Section 7 scenario", "Polling fallback in example for environments without Realtime"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc builds clean (0 errors). two-agents.ts exists with full demo scenario. README updated. Git commit of 19 files succeeded."
completed_at: 2026-03-31T21:17:28.506Z
blocker_discovered: false
---

# T02: Created two-agent demo example and updated README with messaging docs

> Created two-agent demo example and updated README with messaging docs

## What Happened
---
id: T02
parent: S02
milestone: M002
key_files:
  - examples/two-agents.ts
  - README.md
key_decisions:
  - two-agents.ts demonstrates full PRD Section 7 scenario
  - Polling fallback in example for environments without Realtime
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:17:28.506Z
blocker_discovered: false
---

# T02: Created two-agent demo example and updated README with messaging docs

**Created two-agent demo example and updated README with messaging docs**

## What Happened

Created two-agents.ts example implementing the full PRD Section 7 demo: Agent A registers with research-summarization, Agent B discovers and sends a task_request, Agent A processes and sends task_result back. Updated README with messaging examples. tsc build passes clean. All committed.

## Verification

tsc builds clean (0 errors). two-agents.ts exists with full demo scenario. README updated. Git commit of 19 files succeeded.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc (build)` | 0 | pass | 4500ms |
| 2 | `git commit (19 files)` | 0 | pass | 500ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `examples/two-agents.ts`
- `README.md`


## Deviations
None.

## Known Issues
None.
