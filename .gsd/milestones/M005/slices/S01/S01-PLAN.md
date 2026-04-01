# S01: Token Ledger — Balances, Transactions & Transfer API

**Goal:** Create balances and transactions tables, atomic transfer Postgres function, balance/transaction API endpoints, and auto-grant starting balance on registration
**Demo:** After this: Postgres function atomically transfers tokens between agents; balances table tracks all agents

## Tasks
- [x] **T01: Created token ledger: balances, transactions, atomic transfer with row locking, auto-grant on registration** — 1. Create migration with:
   - balances table: agent_id UUID PK FK agents, balance BIGINT NOT NULL DEFAULT 0, CHECK >= 0, updated_at
   - transactions table: id UUID PK, from_agent_id, to_agent_id, amount BIGINT, type (task_payment/starting_grant/manual_credit), message_id FK nullable, description, created_at
   - oacp_transfer(from_id, to_id, amount, type, msg_id, desc): atomic Postgres function using SELECT FOR UPDATE to lock rows
   - oacp_grant_starting_balance(agent_id): grants 1000 tokens, idempotent
   - Trigger: auto-grant starting balance on agents INSERT
   - Indexes on transactions: from_agent_id, to_agent_id, message_id
   - Realtime on balances table
2. Push migration to Supabase
  - Estimate: 20min
  - Files: supabase/migrations/20250331000004_token_economy.sql
  - Verify: Migration pushed to Supabase successfully
- [x] **T02: Added GET /balance, GET /transactions, POST /transfer endpoints to Edge Function** — 1. Add to Edge Function router:
   - GET /oacp/balance?agent_id= (public, returns balance)
   - GET /oacp/transactions?agent_id= (auth required, returns history)
   - POST /oacp/transfer (auth required, calls oacp_transfer)
2. Modify POST /register to call oacp_grant_starting_balance after insert
3. Test endpoints
  - Estimate: 20min
  - Files: supabase/functions/oacp/index.ts
  - Verify: Endpoints return correct data; registration grants starting balance
- [x] **T03: Deployed and verified: registration grants 1000 tokens, balance API works** — 1. Deploy updated Edge Function
2. Register a test agent, verify 1000 starting balance
3. Commit and push
  - Estimate: 10min
  - Verify: New registration returns balance; GET /balance shows 1000
