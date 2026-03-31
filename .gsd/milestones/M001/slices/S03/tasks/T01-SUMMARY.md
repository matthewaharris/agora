---
id: T01
parent: S03
milestone: M001
provides: []
requires: []
affects: []
key_files: ["packages/oacp-sdk/src/crypto.ts", "packages/oacp-sdk/src/types.ts", "packages/oacp-sdk/package.json"]
key_decisions: ["Used sync Ed25519 methods with sha512 setup for simpler SDK API", "Keypair persistence as JSON file with 0o600 permissions", "Hex encoding for all keys and signatures (consistent with Edge Function)"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "crypto.ts contains generateKeypair, signMessage, verifySignature, loadOrCreateKeypair. types.ts contains all protocol types. package.json has @noble/hashes added."
completed_at: 2026-03-31T20:37:14.858Z
blocker_discovered: false
---

# T01: Built Ed25519 crypto module (keygen, sign, verify, keypair persistence) and SDK type definitions

> Built Ed25519 crypto module (keygen, sign, verify, keypair persistence) and SDK type definitions

## What Happened
---
id: T01
parent: S03
milestone: M001
key_files:
  - packages/oacp-sdk/src/crypto.ts
  - packages/oacp-sdk/src/types.ts
  - packages/oacp-sdk/package.json
key_decisions:
  - Used sync Ed25519 methods with sha512 setup for simpler SDK API
  - Keypair persistence as JSON file with 0o600 permissions
  - Hex encoding for all keys and signatures (consistent with Edge Function)
duration: ""
verification_result: passed
completed_at: 2026-03-31T20:37:14.859Z
blocker_discovered: false
---

# T01: Built Ed25519 crypto module (keygen, sign, verify, keypair persistence) and SDK type definitions

**Built Ed25519 crypto module (keygen, sign, verify, keypair persistence) and SDK type definitions**

## What Happened

Built the Ed25519 identity module with keygen, sign, verify, and persistent keypair storage. Uses @noble/ed25519 with sync methods (sha512 set up via @noble/hashes). Keys and signatures are hex-encoded for consistency with the Edge Function API. Created SDK types module that mirrors and re-exports all OACP protocol types.

## Verification

crypto.ts contains generateKeypair, signMessage, verifySignature, loadOrCreateKeypair. types.ts contains all protocol types. package.json has @noble/hashes added.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `structural check on crypto.ts and types.ts` | 0 | pass | 50ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `packages/oacp-sdk/src/crypto.ts`
- `packages/oacp-sdk/src/types.ts`
- `packages/oacp-sdk/package.json`


## Deviations
None.

## Known Issues
None.
