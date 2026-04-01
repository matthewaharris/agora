---
estimated_steps: 6
estimated_files: 2
skills_used: []
---

# T01: SDK: price field, balance checks, auto-transfer

1. Add price field to ActionSpec in trust.ts
2. Add getBalance() and getTransactions() methods to OACPAgent
3. Modify send() to check balance before sending task_request (if target has a price)
4. Modify handleTrustedTask pipeline: after successful handler, auto-call POST /transfer
5. Price published in Agent Card metadata alongside action_specs
6. Build SDK

## Inputs

- None specified.

## Expected Output

- `packages/oacp-sdk/src/trust.ts (updated)`
- `packages/oacp-sdk/src/agent.ts (updated)`

## Verification

tsc --noEmit passes; getBalance, price, transfer logic present
