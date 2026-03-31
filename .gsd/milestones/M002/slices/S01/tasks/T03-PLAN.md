---
estimated_steps: 6
estimated_files: 1
skills_used: []
---

# T03: Update integration test script and commit

1. Add message endpoint tests to scripts/test-api.sh:
   - Send a task_request between two registered agents
   - Verify message appears in GET /messages for recipient
   - Verify invalid signature is rejected
   - Verify unknown recipient is rejected
2. Commit all S01 work

## Inputs

- `supabase/functions/oacp/index.ts`

## Expected Output

- `scripts/test-api.sh (updated)`

## Verification

Test script has message endpoint coverage; git commit succeeds
