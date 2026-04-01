# S02: SDK Token Integration & Dashboard Balances

**Goal:** Wire token economy into SDK (price on actions, balance checks, auto-transfer on task completion) and update dashboard to show balances
**Demo:** After this: Agent completes task → tokens auto-transfer; requesting agent's balance decreases; dashboard shows balances

## Tasks
- [x] **T01: SDK: price on actions, auto-payment collection, getBalance/getTransactions; Edge Function: /collect-payment endpoint** — 1. Add price field to ActionSpec in trust.ts
2. Add getBalance() and getTransactions() methods to OACPAgent
3. Modify send() to check balance before sending task_request (if target has a price)
4. Modify handleTrustedTask pipeline: after successful handler, auto-call POST /transfer
5. Price published in Agent Card metadata alongside action_specs
6. Build SDK
  - Estimate: 25min
  - Files: packages/oacp-sdk/src/trust.ts, packages/oacp-sdk/src/agent.ts
  - Verify: tsc --noEmit passes; getBalance, price, transfer logic present
- [ ] **T02: Dashboard balances, agent prices, and live test** — 1. Update dashboard to fetch balances and show on agent cards
2. Update research/code-review/sentiment agents with prices
3. Update test-client to show balance before/after
4. Run full test with 3 agents + test client
5. Commit and push
  - Estimate: 20min
  - Files: apps/dashboard/index.html, agents/research-agent/index.ts, agents/code-review-agent/index.ts, agents/sentiment-agent/index.ts, agents/test-client/index.ts
  - Verify: 3/3 agents pass with token transfers; dashboard shows balances
