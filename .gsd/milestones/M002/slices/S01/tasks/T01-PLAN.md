---
estimated_steps: 14
estimated_files: 1
skills_used: []
---

# T01: Create messages table migration

1. Create migration for messages table:
   - message_id UUID PK default gen_random_uuid()
   - sender_agent_id UUID NOT NULL REFERENCES agents(agent_id)
   - recipient_agent_id UUID NOT NULL REFERENCES agents(agent_id)
   - message_type TEXT NOT NULL CHECK (IN task_request, task_ack, task_result, task_error)
   - payload JSONB NOT NULL DEFAULT '{}'
   - signature TEXT NOT NULL
   - correlation_id UUID
   - sequence INTEGER
   - created_at TIMESTAMPTZ DEFAULT now()
2. Add index on recipient_agent_id + created_at for inbox queries
3. Add index on correlation_id for task lifecycle lookups
4. Enable RLS (public read for own messages, service_role write)
5. Enable Realtime on messages table

## Inputs

- `supabase/migrations/20250331000001_create_agents_table.sql`

## Expected Output

- `supabase/migrations/20250331000003_create_messages_table.sql`

## Verification

SQL structural check: table, indexes, RLS, Realtime
