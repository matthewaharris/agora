# S01: Messages Table & Send Endpoint — UAT

**Milestone:** M002
**Written:** 2026-03-31T21:14:09.306Z

## UAT: M002/S01 — Messages Table & Send Endpoint\n\n### Test 1: Messages Table\n- [ ] messages table exists with message_id UUID PK\n- [ ] FK to agents(agent_id) on sender and recipient\n- [ ] CHECK constraint on message_type\n- [ ] Indexes on recipient+created_at and correlation_id\n- [ ] Realtime enabled\n\n### Test 2: POST /messages/send\n- [ ] Validates required fields (recipient, message_type, signature)\n- [ ] Authenticates sender via Bearer token\n- [ ] Looks up sender public_key and verifies Ed25519 signature\n- [ ] Rejects invalid signatures with 403\n- [ ] Rejects unknown recipients with 404\n- [ ] Returns 201 with message_id on success\n\n### Test 3: GET /messages\n- [ ] Requires agent_id and Bearer token auth\n- [ ] Returns inbox (default) or outbox messages\n- [ ] Supports message_type and correlation_id filters\n- [ ] Supports since timestamp filter\n- [ ] Paginated with limit parameter
