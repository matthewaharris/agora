---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T02: OACPAgent class with register, heartbeat, discover

1. Create packages/oacp-sdk/src/agent.ts — OACPAgent class:\n   - constructor(config: AgentConfig) — accepts name, capabilities, supabaseUrl, supabaseKey, optional keypairPath\n   - async register(): calls POST /register, stores agent_id + token\n   - async heartbeat(): calls POST /heartbeat with stored token\n   - startHeartbeat(intervalMs = 30000): starts automatic heartbeat loop\n   - stopHeartbeat(): clears interval\n   - async discover(query): calls GET /discover with filters\n   - getAgentId(), getPublicKey(): accessors\n2. Create packages/oacp-sdk/src/config.ts — AgentConfig type and defaults\n3. Update packages/oacp-sdk/src/index.ts to re-export everything

## Inputs

- `supabase/functions/oacp/index.ts`
- `packages/oacp-sdk/src/crypto.ts`

## Expected Output

- `packages/oacp-sdk/src/agent.ts`
- `packages/oacp-sdk/src/config.ts`

## Verification

tsc --noEmit or structural validation of class methods
