---
estimated_steps: 6
estimated_files: 1
skills_used: []
---

# T02: Add balance and transaction API endpoints

1. Add to Edge Function router:
   - GET /oacp/balance?agent_id= (public, returns balance)
   - GET /oacp/transactions?agent_id= (auth required, returns history)
   - POST /oacp/transfer (auth required, calls oacp_transfer)
2. Modify POST /register to call oacp_grant_starting_balance after insert
3. Test endpoints

## Inputs

- `supabase/migrations/20250331000004_token_economy.sql`

## Expected Output

- `supabase/functions/oacp/index.ts`

## Verification

Endpoints return correct data; registration grants starting balance
