-- Add unique constraint on public_key to enforce one agent per keypair
-- This enables persistent identity: same keypair = same agent_id across restarts

-- First, clean up any duplicate public_keys (keep the most recent)
DELETE FROM agents a
USING agents b
WHERE a.agent_id < b.agent_id
  AND a.public_key = b.public_key;

-- Add the unique constraint
ALTER TABLE agents ADD CONSTRAINT agents_public_key_unique UNIQUE (public_key);

COMMENT ON CONSTRAINT agents_public_key_unique ON agents IS 'Enforces one agent per Ed25519 keypair — enables persistent identity across restarts';
