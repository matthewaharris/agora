---
id: T01
parent: S01
milestone: M004
provides: []
requires: []
affects: []
key_files: ["packages/oacp-sdk/src/trust.ts", "packages/oacp-sdk/src/config.ts", "packages/oacp-sdk/src/index.ts"]
key_decisions: ["ActionSpec uses name+description+inputSchema pattern (like a typed function signature)", "TrustPolicy supports 'open', 'none', or explicit agent_id allowlist", "Lightweight SimpleSchema validator instead of full JSON Schema dependency", "matchAction() supports explicit action field or single-action default"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc --noEmit passes with 0 errors. All types exported."
completed_at: 2026-04-01T04:10:28.322Z
blocker_discovered: false
---

# T01: Defined ActionSpec, TrustPolicy types with payload validator and sender allowlist checker

> Defined ActionSpec, TrustPolicy types with payload validator and sender allowlist checker

## What Happened
---
id: T01
parent: S01
milestone: M004
key_files:
  - packages/oacp-sdk/src/trust.ts
  - packages/oacp-sdk/src/config.ts
  - packages/oacp-sdk/src/index.ts
key_decisions:
  - ActionSpec uses name+description+inputSchema pattern (like a typed function signature)
  - TrustPolicy supports 'open', 'none', or explicit agent_id allowlist
  - Lightweight SimpleSchema validator instead of full JSON Schema dependency
  - matchAction() supports explicit action field or single-action default
duration: ""
verification_result: passed
completed_at: 2026-04-01T04:10:28.323Z
blocker_discovered: false
---

# T01: Defined ActionSpec, TrustPolicy types with payload validator and sender allowlist checker

**Defined ActionSpec, TrustPolicy types with payload validator and sender allowlist checker**

## What Happened

Defined the trust model primitives: ActionSpec (name, description, inputSchema for bounded capability declaration), TrustPolicy (allowedSenders list), and SimpleSchema (lightweight JSON Schema subset for payload validation). Built validatePayload(), isSenderAllowed(), and matchAction() functions. Extended AgentConfig to accept actionSpecs and trustPolicy. All types exported from index.ts. Compiles clean.

## Verification

tsc --noEmit passes with 0 errors. All types exported.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit` | 0 | pass | 4000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `packages/oacp-sdk/src/trust.ts`
- `packages/oacp-sdk/src/config.ts`
- `packages/oacp-sdk/src/index.ts`


## Deviations
None.

## Known Issues
None.
