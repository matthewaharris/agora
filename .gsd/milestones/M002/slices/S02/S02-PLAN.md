# S02: SDK Messaging — send(), on(), Signature Verification

**Goal:** Extend oacp-sdk with send(), on() event handlers, Realtime subscription for incoming messages, and canonical message signing/verification
**Demo:** After this: Two agent scripts exchange a task_request/task_result cycle using agent.send() and agent.on()

## Tasks
- [x] **T01: Added send(), on(), off(), getMessages() to OACPAgent with Ed25519 signing and Realtime subscription** — 1. Add canonicalizeMessage() to packages/oacp-sdk/src/crypto.ts (must match Edge Function version exactly)
2. Add send() method to OACPAgent:
   - Accepts recipientId, messageType, payload, optional correlationId
   - Canonicalizes message content
   - Signs with agent's secret key
   - POSTs to /messages/send with Bearer token
   - Returns message_id
3. Add getMessages() method to OACPAgent:
   - Calls GET /messages with filters
   - Returns typed MessageEnvelope array
4. Add on(eventType, handler) method:
   - Uses Supabase Realtime to subscribe to messages table
   - Filters by recipient_agent_id = this agent
   - Dispatches to registered handlers by message_type
5. Add off(eventType) to unsubscribe
6. Update index.ts exports
  - Estimate: 30min
  - Files: packages/oacp-sdk/src/agent.ts, packages/oacp-sdk/src/crypto.ts, packages/oacp-sdk/src/index.ts
  - Verify: tsc --noEmit passes; send/on/getMessages methods present in agent.ts
- [x] **T02: Created two-agent demo example and updated README with messaging docs** — 1. Run tsc --noEmit to verify zero errors
2. Run tsc to build dist/
3. Update examples/basic-agent.ts to show messaging
4. Create examples/two-agents.ts showing full two-agent demo flow
5. Update README messaging section
6. Commit all M002/S02 work
  - Estimate: 20min
  - Files: examples/two-agents.ts, examples/basic-agent.ts, README.md
  - Verify: tsc builds clean; examples have valid structure; git commit succeeds
