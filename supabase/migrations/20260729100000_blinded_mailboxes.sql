-- RFC 001 Phase 3: blinded mailboxes (§5.1)
--
-- Secret-tier messages stored addressed to a rotating HMAC tag instead of a
-- recipient_agent_id. The registry sees "someone deposited to tag X; someone
-- fetched tag X" — its own tables cannot link the parties. Only the two
-- participants can derive the tag (HMAC over their X25519 pair secret and the
-- current 6-hour epoch), and knowing the tag IS the capability: deposit and
-- fetch carry no account authentication, because authenticating the depositor
-- is precisely what this table must never be able to do.

CREATE TABLE IF NOT EXISTS mailbox_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 64 hex chars = HMAC-SHA256 output. Never an agent_id, never a thread id.
  tag TEXT NOT NULL CHECK (tag ~ '^[0-9a-f]{64}$'),
  -- Opaque ciphertext envelope, stored as text and never parsed: the registry
  -- relays it, it does not get to understand it.
  blob TEXT NOT NULL CHECK (char_length(blob) <= 32768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A mailbox is a dead drop, not an archive: every item expires.
  expires_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE mailbox_items IS
  'RFC 001 §5.1 blinded mailboxes: ciphertext addressed to pseudonymous rotating tags. No column links to agents, owners, or threads — by design.';

CREATE INDEX IF NOT EXISTS idx_mailbox_items_tag
  ON mailbox_items (tag, created_at);

CREATE INDEX IF NOT EXISTS idx_mailbox_items_expiry
  ON mailbox_items (expires_at);

-- Deny-all RLS: the ONLY path to this table is the edge function, where the
-- tag-as-capability model is enforced. PostgREST/anon must see nothing —
-- tags are pseudonyms, but the full table would still expose traffic volume
-- and timing per tag to anyone.
ALTER TABLE mailbox_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Reaper
-- ============================================================
-- DELETES rows outright — the opposite of oacp_reap_expired_payloads'
-- redact-not-delete rule, and deliberately so: a mailbox row contains no
-- parties, no thread, nothing with audit value. The design goal is that the
-- data at rest tells no story, and an empty table tells it best.
CREATE OR REPLACE FUNCTION oacp_reap_mailbox()
RETURNS INT AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  WITH gone AS (
    DELETE FROM mailbox_items
    WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM gone;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION oacp_reap_mailbox IS
  'RFC 001 §5.1: delete expired blinded-mailbox items. Deletion, not redaction — these rows have no envelope worth keeping.';
