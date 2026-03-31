---
estimated_steps: 16
estimated_files: 3
skills_used: []
---

# T01: Add send(), on(), getMessages() to OACPAgent

1. Add canonicalizeMessage() to packages/oacp-sdk/src/crypto.ts (must match Edge Function version exactly)
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

## Inputs

- `supabase/functions/_shared/crypto.ts`
- `supabase/functions/oacp/index.ts`

## Expected Output

- `packages/oacp-sdk/src/agent.ts (updated)`
- `packages/oacp-sdk/src/crypto.ts (updated)`

## Verification

tsc --noEmit passes; send/on/getMessages methods present in agent.ts
