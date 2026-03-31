---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Implement POST /oacp/register endpoint

1. Create supabase/functions/_shared/supabase.ts — initialize Supabase admin client using service_role key from env\n2. Add input validation helper (validateRequired, validateCapabilities)\n3. Implement POST /oacp/register handler:\n   - Parse and validate RegisterRequest body\n   - Generate registry_token (crypto.randomUUID or similar)\n   - Hash registry_token before storage (SHA-256)\n   - Insert into agents table, return agent_id + raw registry_token\n   - Handle re-registration: if agent_id provided and token matches, update fields\n4. Wire handler into router in index.ts\n5. Test with curl examples

## Inputs

- `supabase/functions/_shared/types.ts`
- `supabase/migrations/20250331000001_create_agents_table.sql`

## Expected Output

- `supabase/functions/_shared/supabase.ts`
- `supabase/functions/_shared/validation.ts`

## Verification

Structural check: handler uses supabase client, validates input, inserts row, returns agent_id + token
