-- RFC 004 Phase 1: private-by-default channels between friends
--
-- A friendship carries a default visibility and a sealed-required flag. The
-- registry applies them to EVERY message between the two friends, on any
-- correlation_id — closing the "reply on a new open thread" leak where a
-- counterparty's plaintext reply landed in public_feed.
--
-- Defaults apply retroactively to existing friendships (they were all
-- established by out-of-band friend code, so private+sealed is the intended
-- posture). This immediately hardens channels created before this RFC.

ALTER TABLE friendships
  ADD COLUMN IF NOT EXISTS default_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (default_visibility IN ('open', 'summarized', 'private', 'secret')),
  ADD COLUMN IF NOT EXISTS sealed_required BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN friendships.default_visibility IS
  'RFC 004: visibility tier new threads between these two friends inherit (instead of the global open default).';
COMMENT ON COLUMN friendships.sealed_required IS
  'RFC 004: when true, the registry rejects unsealed messages between these friends (error_code seal_required_by_friendship).';
