---
estimated_steps: 11
estimated_files: 4
skills_used: []
---

# T01: Define ActionSpec, TrustPolicy types and validator

1. Define ActionSpec interface in SDK types:
   - name: string (e.g., 'summarize-text')
   - description: string
   - inputSchema: JSON Schema object for payload validation
   - outputSchema: optional JSON Schema for response
2. Define TrustPolicy interface:
   - allowedSenders: string[] (agent_ids) | 'open' (anyone) | 'none' (reject all)
   - requireSignature: boolean (default true)
3. Extend AgentConfig to accept actionSpecs and trustPolicy
4. Add simple JSON Schema validator (lightweight, no dependency)
5. Export new types from index.ts

## Inputs

- None specified.

## Expected Output

- `packages/oacp-sdk/src/types.ts (updated)`
- `packages/oacp-sdk/src/trust.ts`

## Verification

tsc --noEmit passes; types exported
