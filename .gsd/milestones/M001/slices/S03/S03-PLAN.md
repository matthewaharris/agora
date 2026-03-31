# S03: OACP-SDK Core — Registration, Heartbeat, Discovery

**Goal:** Build the oacp-sdk npm package with OACPAgent class, Ed25519 identity management, and typed methods for register/heartbeat/discover
**Demo:** After this: A TypeScript script using oacp-sdk registers an agent, starts auto-heartbeat, and discovers other agents

## Tasks
- [x] **T01: Built Ed25519 crypto module (keygen, sign, verify, keypair persistence) and SDK type definitions** — 1. Create packages/oacp-sdk/src/crypto.ts — Ed25519 keypair management:\n   - generateKeypair(): returns { secretKey, publicKey } as hex strings\n   - signMessage(message, secretKey): returns hex signature\n   - verifySignature(signature, message, publicKey): returns boolean\n   - loadOrCreateKeypair(configPath): loads from file or generates new\n2. Create packages/oacp-sdk/src/types.ts — re-export shared types for SDK consumers\n3. Install @noble/ed25519 and @noble/hashes dependencies
  - Estimate: 20min
  - Files: packages/oacp-sdk/src/crypto.ts, packages/oacp-sdk/src/types.ts, packages/oacp-sdk/package.json
  - Verify: tsc --noEmit on crypto.ts (or structural check if tsc not available)
- [x] **T02: Built OACPAgent class with register, heartbeat, discover, sign/verify, and clean lifecycle** — 1. Create packages/oacp-sdk/src/agent.ts — OACPAgent class:\n   - constructor(config: AgentConfig) — accepts name, capabilities, supabaseUrl, supabaseKey, optional keypairPath\n   - async register(): calls POST /register, stores agent_id + token\n   - async heartbeat(): calls POST /heartbeat with stored token\n   - startHeartbeat(intervalMs = 30000): starts automatic heartbeat loop\n   - stopHeartbeat(): clears interval\n   - async discover(query): calls GET /discover with filters\n   - getAgentId(), getPublicKey(): accessors\n2. Create packages/oacp-sdk/src/config.ts — AgentConfig type and defaults\n3. Update packages/oacp-sdk/src/index.ts to re-export everything
  - Estimate: 30min
  - Files: packages/oacp-sdk/src/agent.ts, packages/oacp-sdk/src/config.ts, packages/oacp-sdk/src/index.ts
  - Verify: tsc --noEmit or structural validation of class methods
- [x] **T03: SDK builds clean with zero type errors; example script and docs ready** — 1. Run npm install in packages/oacp-sdk to verify deps resolve\n2. Run tsc build to verify compilation\n3. Create a simple example script (examples/basic-agent.ts) showing SDK usage\n4. Update README with SDK section\n5. Commit all S03 work
  - Estimate: 15min
  - Files: packages/oacp-sdk/src/index.ts, examples/basic-agent.ts, README.md
  - Verify: npm run build in packages/oacp-sdk succeeds; example script has valid syntax
