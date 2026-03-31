---
id: T01
parent: S03
milestone: M003
provides: []
requires: []
affects: []
key_files: ["scripts/demo.sh", "README.md", ".gsd/PROJECT.md", "package.json"]
key_decisions: ["Demo script auto-creates .env files from environment variables", "Three quick-start paths in README (one-command, step-by-step, local Supabase)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Demo script exists with prereq check, SDK build, agent install, background start, and cleanup. README has 3 quick-start options. Git commit succeeded."
completed_at: 2026-03-31T21:26:50.660Z
blocker_discovered: false
---

# T01: Created one-command demo script and comprehensive README with three quick-start paths

> Created one-command demo script and comprehensive README with three quick-start paths

## What Happened
---
id: T01
parent: S03
milestone: M003
key_files:
  - scripts/demo.sh
  - README.md
  - .gsd/PROJECT.md
  - package.json
key_decisions:
  - Demo script auto-creates .env files from environment variables
  - Three quick-start paths in README (one-command, step-by-step, local Supabase)
duration: ""
verification_result: passed
completed_at: 2026-03-31T21:26:50.660Z
blocker_discovered: false
---

# T01: Created one-command demo script and comprehensive README with three quick-start paths

**Created one-command demo script and comprehensive README with three quick-start paths**

## What Happened

Created demo.sh orchestration script that checks prerequisites, builds SDK, installs agent dependencies, starts research-agent in background, runs extraction-agent to completion, and reports results. Updated README with three quick-start options and full demo walkthrough. Updated PROJECT.md to reflect demo-ready state.

## Verification

Demo script exists with prereq check, SDK build, agent install, background start, and cleanup. README has 3 quick-start options. Git commit succeeded.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `git commit (16 files)` | 0 | pass | 500ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/demo.sh`
- `README.md`
- `.gsd/PROJECT.md`
- `package.json`


## Deviations
None.

## Known Issues
None.
