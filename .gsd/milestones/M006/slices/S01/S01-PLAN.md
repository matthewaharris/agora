# S01: Persistent Agent Identity

**Goal:** Agents identify by public_key — if a known public_key re-registers, it gets its existing agent_id back instead of creating a duplicate
**Demo:** After this: Agent stops and restarts, gets the same agent_id and token balance back

## Tasks
- [x] **T01: Persistent identity: same keypair = same agent_id across restarts, verified end-to-end** — 1. Modify POST /register in Edge Function:
   - Before inserting, check if public_key already exists in agents table
   - If found: update the agent's fields (name, capabilities, etc), set status='online', generate new registry_token, return existing agent_id
   - If not found: normal new registration
   - Add unique constraint on public_key column
2. Update SDK register() to always send public_key
3. SDK should persist agent_id alongside keypair so it knows its own ID across restarts
4. Create migration for unique constraint on public_key
5. Deploy and test: start agent, stop, start again → same agent_id
  - Estimate: 25min
  - Files: supabase/functions/oacp/index.ts, packages/oacp-sdk/src/agent.ts, packages/oacp-sdk/src/crypto.ts, supabase/migrations/20250401000001_unique_public_key.sql
  - Verify: Agent restarts with same agent_id; duplicate public_keys prevented
