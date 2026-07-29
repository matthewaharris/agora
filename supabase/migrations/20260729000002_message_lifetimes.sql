-- RFC 001 Phase 3 (partial): message lifetimes
--
-- From the field report: "Sealed messages persist forever. There's no TTL, no
-- burn-after-read, no way to mark a payload as never-persist. For credentials
-- and incident detail, that matters — his agent had to reason from first
-- principles about what was safe to send, and got it right, but the protocol
-- gave it no help."
--
-- Sealing controls WHO can read a payload. It says nothing about HOW LONG the
-- ciphertext sits in a table waiting for a future key compromise. These are
-- different questions and only the first had an answer.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  -- Burn-after-read: cleared as soon as the recipient has actually fetched it.
  ADD COLUMN IF NOT EXISTS burn_after_read BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.expires_at IS
  'RFC 001 §5: payload is redacted by the reaper after this time. NULL = keep (current default).';
COMMENT ON COLUMN messages.burn_after_read IS
  'RFC 001 §5: redact the payload as soon as the recipient has fetched it once.';
COMMENT ON COLUMN messages.read_at IS
  'First time the recipient fetched this message through the authenticated inbox.';

CREATE INDEX IF NOT EXISTS idx_messages_expiring
  ON messages (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_burn_pending
  ON messages (recipient_agent_id)
  WHERE burn_after_read AND read_at IS NOT NULL;

-- ============================================================
-- Reaper
-- ============================================================
-- Redacts payloads rather than deleting rows: the envelope (who talked to
-- whom, when, on what thread) is what makes the kill switch and the audit
-- trail work, and destroying it to protect content would trade one property
-- for another. Content goes; the fact of the exchange stays.
CREATE OR REPLACE FUNCTION oacp_reap_expired_payloads()
RETURNS JSONB AS $$
DECLARE
  v_expired INT := 0;
  v_burned  INT := 0;
BEGIN
  WITH reaped AS (
    UPDATE messages
    SET payload = jsonb_build_object(
          'redacted', true,
          'reason', 'expired',
          'redacted_at', now()
        )
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
      AND NOT (payload ? 'redacted')
    RETURNING 1
  )
  SELECT count(*) INTO v_expired FROM reaped;

  WITH burned AS (
    UPDATE messages
    SET payload = jsonb_build_object(
          'redacted', true,
          'reason', 'burn_after_read',
          'redacted_at', now()
        )
    WHERE burn_after_read
      AND read_at IS NOT NULL
      -- Small grace window: a client that crashes mid-fetch gets one retry
      -- rather than losing the payload to its own network error.
      AND read_at < now() - INTERVAL '2 minutes'
      AND NOT (payload ? 'redacted')
    RETURNING 1
  )
  SELECT count(*) INTO v_burned FROM burned;

  RETURN jsonb_build_object('expired', v_expired, 'burned', v_burned);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION oacp_reap_expired_payloads IS
  'RFC 001 §5: redact payloads past their TTL or already read once. Envelopes are preserved so thread control and audit still work.';
