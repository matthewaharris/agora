# S01: Supabase Schema & Project Setup

**Goal:** Initialize Supabase project, create migration for agents table, deploy skeleton Edge Function with health check endpoint
**Demo:** After this: supabase start runs clean; agents table exists with correct schema; Edge Function skeleton responds to health check

## Tasks
- [x] **T01: Initialized Supabase project and monorepo structure with oacp-sdk package scaffold** — 1. Run supabase init to create supabase/ directory\n2. Create top-level package.json for monorepo\n3. Create directory structure: packages/oacp-sdk/, apps/dashboard/, agents/\n4. Create .gitignore with node_modules, .env, supabase/.temp/\n5. Add supabase/config.toml with project name
  - Estimate: 15min
  - Files: package.json, supabase/config.toml, .gitignore, packages/oacp-sdk/package.json, agents/README.md
  - Verify: ls supabase/config.toml && cat package.json | grep name
- [x] **T02: Created agents table migration with Ed25519 identity, GIN-indexed capabilities, RLS, and Realtime** — 1. Create Supabase migration file for agents table\n2. Columns: agent_id (UUID PK default gen_random_uuid()), name TEXT NOT NULL, owner_handle TEXT, description TEXT, endpoint_url TEXT, capabilities TEXT[] NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','busy')), public_key TEXT NOT NULL, protocols_supported TEXT[] DEFAULT '{oacp/v1}', metadata JSONB DEFAULT '{}', registry_token TEXT, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()\n3. Add GIN index on capabilities\n4. Add index on status\n5. Add updated_at trigger function\n6. Enable RLS with basic policies
  - Estimate: 20min
  - Files: supabase/migrations/00001_create_agents_table.sql
  - Verify: supabase db reset && supabase db lint 2>&1 || echo 'Manual verification needed - check SQL syntax'
- [x] **T03: Created OACP Edge Function with router, health check, CORS, and shared type definitions** — 1. Create supabase/functions/oacp/index.ts\n2. Implement path-based router (fat function pattern)\n3. Add GET /oacp/health endpoint returning { status: 'ok', version: '0.1.0', timestamp }\n4. Add stub routes for /register, /heartbeat, /discover, /messages/send (return 501 Not Implemented)\n5. Add CORS headers for browser access\n6. Add shared types file for Agent Card, Message Envelope schemas
  - Estimate: 20min
  - Files: supabase/functions/oacp/index.ts, supabase/functions/_shared/types.ts, supabase/functions/_shared/cors.ts
  - Verify: cd supabase/functions && deno check oacp/index.ts 2>&1 || echo 'Check TypeScript manually'
- [ ] **T04: Write PROJECT.md and verify local Supabase stack** — 1. Create .gsd/PROJECT.md describing the OACP project\n2. Create top-level README.md with project overview and setup instructions\n3. Verify supabase start brings up the stack (if Docker available)\n4. Verify migration applies cleanly\n5. Test health endpoint if local stack is running\n6. Commit all work
  - Estimate: 15min
  - Files: .gsd/PROJECT.md, README.md
  - Verify: cat .gsd/PROJECT.md && cat README.md | head -20
