---
estimated_steps: 9
estimated_files: 4
skills_used: []
---

# T01: Implement public_key-based identity persistence

1. Modify POST /register in Edge Function:
   - Before inserting, check if public_key already exists in agents table
   - If found: update the agent's fields (name, capabilities, etc), set status='online', generate new registry_token, return existing agent_id
   - If not found: normal new registration
   - Add unique constraint on public_key column
2. Update SDK register() to always send public_key
3. SDK should persist agent_id alongside keypair so it knows its own ID across restarts
4. Create migration for unique constraint on public_key
5. Deploy and test: start agent, stop, start again → same agent_id

## Inputs

- None specified.

## Expected Output

- `supabase/migrations/20250401000001_unique_public_key.sql`

## Verification

Agent restarts with same agent_id; duplicate public_keys prevented
