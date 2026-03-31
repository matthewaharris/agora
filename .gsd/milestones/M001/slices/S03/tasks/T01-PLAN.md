---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Ed25519 identity module and SDK types

1. Create packages/oacp-sdk/src/crypto.ts — Ed25519 keypair management:\n   - generateKeypair(): returns { secretKey, publicKey } as hex strings\n   - signMessage(message, secretKey): returns hex signature\n   - verifySignature(signature, message, publicKey): returns boolean\n   - loadOrCreateKeypair(configPath): loads from file or generates new\n2. Create packages/oacp-sdk/src/types.ts — re-export shared types for SDK consumers\n3. Install @noble/ed25519 and @noble/hashes dependencies

## Inputs

- `supabase/functions/_shared/types.ts`

## Expected Output

- `packages/oacp-sdk/src/crypto.ts`
- `packages/oacp-sdk/src/types.ts`

## Verification

tsc --noEmit on crypto.ts (or structural check if tsc not available)
