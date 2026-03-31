# S02: SDK Messaging — send(), on(), Signature Verification — UAT

**Milestone:** M002
**Written:** 2026-03-31T21:17:53.286Z

## UAT: M002/S02 — SDK Messaging\n\n### Test 1: send()\n- [ ] Canonicalizes message with sorted keys\n- [ ] Signs with agent's Ed25519 secret key\n- [ ] POSTs to /messages/send with Bearer token\n- [ ] Returns message_id on success\n\n### Test 2: on()/off()\n- [ ] on('task_request', handler) registers handler\n- [ ] Supabase Realtime subscription starts on first on()\n- [ ] Handler receives incoming messages matching type\n- [ ] Wildcard '*' handler receives all types\n- [ ] off() removes handlers and unsubscribes when empty\n\n### Test 3: getMessages()\n- [ ] Retrieves inbox messages with auth\n- [ ] Supports direction, messageType, correlationId, since filters\n\n### Test 4: Two-Agent Demo\n- [ ] examples/two-agents.ts runs the full PRD Section 7 scenario\n- [ ] Agent A registers and listens for tasks\n- [ ] Agent B discovers, sends task, receives result
