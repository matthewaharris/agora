---
id: S03
parent: M001
milestone: M001
provides:
  - oacp-sdk npm package with OACPAgent class
  - Ed25519 keygen/sign/verify utilities
  - Typed API for register, heartbeat, discover
  - Example agent script
requires:
  - slice: S02
    provides: Working /register, /heartbeat, /discover endpoints
affects:
  - M002/S01
  - M002/S02
  - M003/S01
key_files:
  - packages/oacp-sdk/src/agent.ts
  - packages/oacp-sdk/src/crypto.ts
  - packages/oacp-sdk/src/types.ts
  - packages/oacp-sdk/src/index.ts
  - examples/basic-agent.ts
key_decisions:
  - ESM package for modern Node.js
  - Sync Ed25519 methods with @noble/hashes sha512
  - Keypair persistence as JSON file with 0o600 permissions
patterns_established:
  - OACPAgent class as single entry point for SDK consumers
  - Hex encoding for all cryptographic values
  - JSON keypair persistence with file permissions
  - ESM module with .js extension imports
observability_surfaces:
  - [OACP] console.log for registration, heartbeat, and lifecycle events
  - Keypair file creation logged
drill_down_paths:
  - .gsd/milestones/M001/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:51:44.058Z
blocker_discovered: false
---

# S03: OACP-SDK Core — Registration, Heartbeat, Discovery

**Built oacp-sdk with OACPAgent class, Ed25519 crypto, typed API, and clean TypeScript build**

## What Happened

Built the complete oacp-sdk TypeScript package: OACPAgent class manages the full agent lifecycle (keypair generation, registration, heartbeat, discovery), Ed25519 crypto module handles identity and message signing, types module provides full protocol type definitions. The SDK builds clean with zero TypeScript errors and produces declaration files for consumers. An example script demonstrates the complete workflow.

## Verification

tsc --noEmit: 0 errors. tsc build: 10 output files. Git commit: 25 files. All structural checks pass.

## Requirements Advanced

- REQ-AGENT-01 — SDK provides register(), heartbeat(), discover() matching API contract
- REQ-AGENT-02 — Event-driven API foundation with sign/verify for future on() handler
- REQ-AGENT-03 — Ed25519 signing with @noble/ed25519

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Fixed three TypeScript issues during build (ESM, @noble/ed25519 v3 API, type assertions). These were normal integration issues, not plan deviations.

## Known Limitations

SDK messaging (send/on) deferred to M002. Integration tests require live Supabase.

## Follow-ups

None.

## Files Created/Modified

- `packages/oacp-sdk/src/agent.ts` — OACPAgent class with register, heartbeat, discover, sign, verify, shutdown
- `packages/oacp-sdk/src/crypto.ts` — Ed25519 keygen, sign, verify, keypair persistence
- `packages/oacp-sdk/src/types.ts` — All OACP protocol type definitions for SDK consumers
- `packages/oacp-sdk/src/config.ts` — AgentConfig type and defaults
- `packages/oacp-sdk/src/index.ts` — Re-exports entire SDK public API
- `packages/oacp-sdk/package.json` — Added type:module, @noble/hashes dep
- `examples/basic-agent.ts` — Complete working example of SDK usage
- `README.md` — Added SDK usage section
