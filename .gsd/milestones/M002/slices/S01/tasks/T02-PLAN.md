---
estimated_steps: 12
estimated_files: 2
skills_used: []
---

# T02: Implement POST /oacp/messages/send with signature verification

1. Import Ed25519 verification into Edge Function (use @noble/ed25519 via esm.sh)
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

## Inputs

- `supabase/functions/_shared/types.ts`
- `supabase/functions/_shared/validation.ts`

## Expected Output

- `supabase/functions/_shared/crypto.ts`

## Verification

Structural check: handler validates, verifies sig, inserts, returns message_id
