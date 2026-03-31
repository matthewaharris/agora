---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T03: Create OACP Edge Function with health check and router

1. Create supabase/functions/oacp/index.ts\n2. Implement path-based router (fat function pattern)\n3. Add GET /oacp/health endpoint returning { status: 'ok', version: '0.1.0', timestamp }\n4. Add stub routes for /register, /heartbeat, /discover, /messages/send (return 501 Not Implemented)\n5. Add CORS headers for browser access\n6. Add shared types file for Agent Card, Message Envelope schemas

## Inputs

- None specified.

## Expected Output

- `supabase/functions/oacp/index.ts`
- `supabase/functions/_shared/types.ts`
- `supabase/functions/_shared/cors.ts`

## Verification

cd supabase/functions && deno check oacp/index.ts 2>&1 || echo 'Check TypeScript manually'
