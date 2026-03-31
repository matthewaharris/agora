# S01: Messages Table & Send Endpoint

**Goal:** Create messages table with Realtime enabled and implement POST /oacp/messages/send endpoint with signature verification and message routing
**Demo:** After this: curl POST to /oacp/messages/send stores message and triggers Realtime event visible in Supabase dashboard

## Tasks
- [x] **T01: Created messages table migration with FKs, indexes, RLS, and Realtime — 12/12 structural checks pass** — 1. Create migration for messages table:
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
  - Estimate: 15min
  - Files: supabase/migrations/20250331000003_create_messages_table.sql
  - Verify: SQL structural check: table, indexes, RLS, Realtime
- [x] **T02: Implemented POST /messages/send with Ed25519 signature verification and GET /messages for inbox/outbox retrieval** — 1. Import Ed25519 verification into Edge Function (use @noble/ed25519 via esm.sh)
2. Implement POST /oacp/messages/send handler:
   - Parse and validate SendMessageRequest body
   - Verify sender exists and Bearer token matches
   - Look up sender's public_key from agents table
   - Verify Ed25519 signature on the canonical message payload
   - Generate message_id, add timestamp
   - Insert into messages table
   - Return message_id + timestamp
3. Create canonical message format function for deterministic signing
4. Wire handler into router (replace stub)
5. Also implement GET /oacp/messages endpoint to retrieve messages for an agent
  - Estimate: 30min
  - Files: supabase/functions/oacp/index.ts, supabase/functions/_shared/crypto.ts
  - Verify: Structural check: handler validates, verifies sig, inserts, returns message_id
- [ ] **T03: Update integration test script and commit** — 1. Add message endpoint tests to scripts/test-api.sh:
   - Send a task_request between two registered agents
   - Verify message appears in GET /messages for recipient
   - Verify invalid signature is rejected
   - Verify unknown recipient is rejected
2. Commit all S01 work
  - Estimate: 15min
  - Files: scripts/test-api.sh
  - Verify: Test script has message endpoint coverage; git commit succeeds
