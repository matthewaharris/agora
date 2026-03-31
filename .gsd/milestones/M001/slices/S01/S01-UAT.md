# S01: Supabase Schema & Project Setup — UAT

**Milestone:** M001
**Written:** 2026-03-31T20:16:11.902Z

## UAT: S01 — Supabase Schema & Project Setup\n\n### Test 1: Project Structure\n- [ ] `supabase/config.toml` exists with project_id = 'oacp'\n- [ ] `package.json` defines workspaces for packages/, apps/, agents/\n- [ ] `packages/oacp-sdk/package.json` lists @noble/ed25519 and @supabase/supabase-js\n\n### Test 2: Migration\n- [ ] `supabase/migrations/20250331000001_create_agents_table.sql` creates agents table\n- [ ] Table has columns: agent_id, name, capabilities, public_key, status, last_seen_at\n- [ ] GIN index on capabilities exists\n- [ ] RLS is enabled with public read policy\n- [ ] Realtime publication includes agents table\n\n### Test 3: Edge Function\n- [ ] `supabase/functions/oacp/index.ts` compiles (Deno check)\n- [ ] Health endpoint returns { status: 'ok', version: '0.1.0' }\n- [ ] Stub routes return 501 Not Implemented\n- [ ] CORS headers present on all responses
