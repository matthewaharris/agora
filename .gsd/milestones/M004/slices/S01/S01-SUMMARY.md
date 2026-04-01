---
id: S01
parent: M004
milestone: M004
provides:
  - ActionSpec + TrustPolicy types
  - Trust validation pipeline in SDK
  - registerAction() method
requires:
  []
affects:
  - S02
  - S03
key_files:
  - packages/oacp-sdk/src/trust.ts
  - packages/oacp-sdk/src/agent.ts
key_decisions:
  - Capability-scoped execution boundaries
  - Typed task_error codes
  - Action specs in Agent Card metadata
patterns_established:
  - registerAction() pattern for trust-validated handlers
  - Typed task_error codes for machine-readable rejections
observability_surfaces:
  - Trust decisions logged with pass/reject and reason
  - Action specs visible in Agent Card metadata
drill_down_paths:
  - .gsd/milestones/M004/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-01T04:50:52.405Z
blocker_discovered: false
---

# S01: Agent Trust Model — Action Specs & Sender Allowlists

**Built agent trust model with action specs, sender allowlists, and validated execution pipeline**

## What Happened

Built and verified the complete agent trust model. Agents declare bounded ActionSpecs, control who can invoke them via TrustPolicy, and validate all incoming payloads before processing. The trust pipeline runs automatically through registerAction(), sending typed task_error responses for unauthorized senders, unknown actions, and invalid payloads. Fixed a Realtime subscription timing bug. Verified end-to-end against live Supabase.

## Verification

Live test against Supabase: trust pipeline passes, action executes, result delivered. Exit code 0.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

- Agents need a way to advertise their action_specs in discovery results

## Requirements Invalidated or Re-scoped

None.

## Deviations

Fixed Realtime subscription timing bug discovered during testing.

## Known Limitations

Harmless Realtime warning on extraction agent's second subscription attempt.

## Follow-ups

None.

## Files Created/Modified

- `packages/oacp-sdk/src/trust.ts` — ActionSpec, TrustPolicy, validatePayload, isSenderAllowed, matchAction
- `packages/oacp-sdk/src/agent.ts` — registerAction(), trust pipeline, deferred Realtime subscription
- `packages/oacp-sdk/src/config.ts` — Added actionSpecs and trustPolicy to config
- `packages/oacp-sdk/src/index.ts` — Trust model exports
- `agents/research-agent/index.ts` — Uses registerAction with action spec
- `agents/extraction-agent/index.ts` — Includes action field in task payload
