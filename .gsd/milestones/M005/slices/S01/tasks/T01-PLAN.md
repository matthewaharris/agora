---
estimated_steps: 9
estimated_files: 1
skills_used: []
---

# T01: Create token economy migration

1. Create migration with:
   - balances table: agent_id UUID PK FK agents, balance BIGINT NOT NULL DEFAULT 0, CHECK >= 0, updated_at
   - transactions table: id UUID PK, from_agent_id, to_agent_id, amount BIGINT, type (task_payment/starting_grant/manual_credit), message_id FK nullable, description, created_at
   - oacp_transfer(from_id, to_id, amount, type, msg_id, desc): atomic Postgres function using SELECT FOR UPDATE to lock rows
   - oacp_grant_starting_balance(agent_id): grants 1000 tokens, idempotent
   - Trigger: auto-grant starting balance on agents INSERT
   - Indexes on transactions: from_agent_id, to_agent_id, message_id
   - Realtime on balances table
2. Push migration to Supabase

## Inputs

- None specified.

## Expected Output

- `supabase/migrations/20250331000004_token_economy.sql`

## Verification

Migration pushed to Supabase successfully
