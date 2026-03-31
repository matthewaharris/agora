---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T02: Create agents table migration

1. Create Supabase migration file for agents table\n2. Columns: agent_id (UUID PK default gen_random_uuid()), name TEXT NOT NULL, owner_handle TEXT, description TEXT, endpoint_url TEXT, capabilities TEXT[] NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','busy')), public_key TEXT NOT NULL, protocols_supported TEXT[] DEFAULT '{oacp/v1}', metadata JSONB DEFAULT '{}', registry_token TEXT, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()\n3. Add GIN index on capabilities\n4. Add index on status\n5. Add updated_at trigger function\n6. Enable RLS with basic policies

## Inputs

- `.gsd/milestones/M001/M001-RESEARCH.md`

## Expected Output

- `supabase/migrations/00001_create_agents_table.sql`

## Verification

supabase db reset && supabase db lint 2>&1 || echo 'Manual verification needed - check SQL syntax'
