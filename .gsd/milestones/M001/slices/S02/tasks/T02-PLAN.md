---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T02: Implement POST /oacp/heartbeat and auto-offline detection

1. Implement POST /oacp/heartbeat handler:\n   - Validate agent_id and registry_token from Authorization header\n   - Update agents.last_seen_at = now() and status = 'online'\n   - Return updated last_seen_at\n2. Create SQL migration for auto-offline function:\n   - pg_cron or Supabase scheduled function that runs every 30s\n   - Sets status = 'offline' for agents where last_seen_at < now() - interval '90 seconds'\n   - Only updates agents currently in 'online' or 'busy' status\n3. Wire heartbeat handler into router

## Inputs

- `supabase/functions/_shared/supabase.ts`

## Expected Output

- `supabase/migrations/20250331000002_auto_offline_function.sql`

## Verification

Structural check: heartbeat updates last_seen_at; auto-offline migration exists with interval logic
