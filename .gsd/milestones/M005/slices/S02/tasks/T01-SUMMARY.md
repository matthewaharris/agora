---
id: T01
parent: S02
milestone: M005
provides: []
requires: []
affects: []
key_files: ["packages/oacp-sdk/src/trust.ts", "packages/oacp-sdk/src/agent.ts", "supabase/functions/oacp/index.ts"]
key_decisions: ["Server-verified payment collection — provider initiates, server verifies message exists", "Price field on ActionSpec (0 = free)", "Payment is best-effort after task completion (task still delivered if payment fails)", "getBalance() and getTransactions() methods on OACPAgent", "Price published in Agent Card metadata"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "tsc --noEmit and tsc both pass. All new methods present."
completed_at: 2026-04-01T16:13:19.552Z
blocker_discovered: false
---

# T01: SDK: price on actions, auto-payment collection, getBalance/getTransactions; Edge Function: /collect-payment endpoint

> SDK: price on actions, auto-payment collection, getBalance/getTransactions; Edge Function: /collect-payment endpoint

## What Happened
---
id: T01
parent: S02
milestone: M005
key_files:
  - packages/oacp-sdk/src/trust.ts
  - packages/oacp-sdk/src/agent.ts
  - supabase/functions/oacp/index.ts
key_decisions:
  - Server-verified payment collection — provider initiates, server verifies message exists
  - Price field on ActionSpec (0 = free)
  - Payment is best-effort after task completion (task still delivered if payment fails)
  - getBalance() and getTransactions() methods on OACPAgent
  - Price published in Agent Card metadata
duration: ""
verification_result: passed
completed_at: 2026-04-01T16:13:19.552Z
blocker_discovered: false
---

# T01: SDK: price on actions, auto-payment collection, getBalance/getTransactions; Edge Function: /collect-payment endpoint

**SDK: price on actions, auto-payment collection, getBalance/getTransactions; Edge Function: /collect-payment endpoint**

## What Happened

Added price field to ActionSpec, getBalance/getTransactions to OACPAgent, auto-payment collection in the trust pipeline (after task_result sent, calls /collect-payment), and a server-verified /collect-payment endpoint that checks the original message exists before debiting the requester. SDK builds clean.

## Verification

tsc --noEmit and tsc both pass. All new methods present.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx tsc --noEmit && npx tsc` | 0 | pass | 8000ms |


## Deviations

Payment collection is server-verified (provider calls /collect-payment, server checks message exists and debits requester) instead of requester-pays pattern. More secure — provider can't forge payments.

## Known Issues

None.

## Files Created/Modified

- `packages/oacp-sdk/src/trust.ts`
- `packages/oacp-sdk/src/agent.ts`
- `supabase/functions/oacp/index.ts`


## Deviations
Payment collection is server-verified (provider calls /collect-payment, server checks message exists and debits requester) instead of requester-pays pattern. More secure — provider can't forge payments.

## Known Issues
None.
