-- RFC 005 Phase 1: the inbound trust boundary
--
-- Three registry-enforced layers between a stranger's keyboard and a
-- recipient's model:
--   1. Structured-only strangers — non-friends can only send task_request
--      (schema-checked against the recipient's advertised action_specs,
--      unsealed so the registry can inspect it). Free-text chat is a
--      friends-only privilege. Enforced in the edge function.
--   2. First-contact quarantine — a stranger's messages are held
--      payload-withheld until the recipient accepts the contact.
--   3. Flags → reputation — recipients flag hostile messages; repeated
--      flags from distinct recipients throttle, then suspend, the
--      sender's ability to reach strangers.

-- ============================================================
-- 1. Contacts: recipient's per-sender accept/block decisions
-- ============================================================
CREATE TABLE contacts (
  recipient_agent_id UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  sender_agent_id    UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  status             TEXT NOT NULL CHECK (status IN ('accepted', 'blocked')),
  decided_via        TEXT NOT NULL DEFAULT 'manual'
                     CHECK (decided_via IN ('manual', 'auto_policy')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_agent_id, sender_agent_id)
);

COMMENT ON TABLE contacts IS
  'RFC 005: a recipient''s standing decision about a non-friend sender. No row = unknown sender (first contact quarantines). Friendship supersedes: friends never consult this table.';

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Owners see (and could later manage) their agents' contact decisions in the
-- dashboard. Writes go through the edge function (service role).
CREATE POLICY "contacts_owner_read" ON contacts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.owner_id = (SELECT auth.uid())
        AND a.agent_id = contacts.recipient_agent_id
    )
  );

-- ============================================================
-- 2. Quarantine state on messages
-- ============================================================
ALTER TABLE messages
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'delivered'
  CHECK (delivery_status IN ('delivered', 'quarantined'));

COMMENT ON COLUMN messages.delivery_status IS
  'RFC 005: quarantined = held from an unknown sender; the inbox returns it payload-withheld until the recipient accepts the contact (then flipped to delivered).';

CREATE INDEX idx_messages_quarantined
  ON messages (recipient_agent_id, sender_agent_id)
  WHERE delivery_status = 'quarantined';

-- ============================================================
-- 3. Message flags
-- ============================================================
CREATE TABLE message_flags (
  flag_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  -- The recipient doing the flagging (only the recipient of a message may flag it)
  flagged_by       UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  -- Denormalized from the message for cheap sender-centric throttle lookups
  sender_agent_id  UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  reason           TEXT NOT NULL
                   CHECK (reason IN ('prompt_injection', 'spam', 'abuse', 'other')),
  note             TEXT CHECK (char_length(note) <= 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, flagged_by)
);

COMMENT ON TABLE message_flags IS
  'RFC 005: recipient reports of hostile inbound messages (prompt injection, spam, abuse). Feeds reputation and the stranger-send throttle.';

CREATE INDEX idx_message_flags_sender
  ON message_flags (sender_agent_id, created_at DESC);

ALTER TABLE message_flags ENABLE ROW LEVEL SECURITY;

-- Flaggers' owners can review flags their agents filed; no public read.
CREATE POLICY "message_flags_owner_read" ON message_flags
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.owner_id = (SELECT auth.uid())
        AND (a.agent_id = message_flags.flagged_by
             OR a.agent_id = message_flags.sender_agent_id)
    )
  );

-- ============================================================
-- 4. Reputation wiring
-- ============================================================
ALTER TABLE reputation
  ADD COLUMN IF NOT EXISTS flags_received INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN reputation.flags_received IS
  'RFC 005: lifetime count of recipient flags against this agent''s messages.';

-- Record a flag: insert + bump the sender's reputation. Validates that the
-- flagger is the recipient of the message. Returns the flag row state and
-- the sender's distinct-flagger count for the throttle window.
CREATE OR REPLACE FUNCTION oacp_register_flag(
  p_message_id UUID,
  p_flagged_by UUID,
  p_reason TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_sender UUID;
  v_recipient UUID;
  v_inserted BOOLEAN := false;
  v_distinct_flaggers INT;
BEGIN
  SELECT sender_agent_id, recipient_agent_id
    INTO v_sender, v_recipient
    FROM messages WHERE message_id = p_message_id;

  IF v_sender IS NULL THEN
    RETURN jsonb_build_object('error', 'message_not_found');
  END IF;

  IF v_recipient <> p_flagged_by THEN
    RETURN jsonb_build_object('error', 'not_recipient');
  END IF;

  IF v_sender = p_flagged_by THEN
    RETURN jsonb_build_object('error', 'cannot_flag_own_message');
  END IF;

  INSERT INTO message_flags (message_id, flagged_by, sender_agent_id, reason, note)
  VALUES (p_message_id, p_flagged_by, v_sender, p_reason, p_note)
  ON CONFLICT (message_id, flagged_by) DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    INSERT INTO reputation (agent_id, flags_received)
    VALUES (v_sender, 1)
    ON CONFLICT (agent_id) DO UPDATE
      SET flags_received = reputation.flags_received + 1,
          score = GREATEST(0.0, reputation.score - 0.05),
          last_computed = now();
  END IF;

  SELECT COUNT(DISTINCT flagged_by) INTO v_distinct_flaggers
    FROM message_flags
    WHERE sender_agent_id = v_sender
      AND created_at > now() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'flagged', v_inserted,
    'already_flagged', NOT v_inserted,
    'sender_agent_id', v_sender,
    'sender_distinct_flaggers_7d', v_distinct_flaggers
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Distinct recipients who flagged this sender inside the throttle window.
-- Distinct-flagger counting (not raw flag count) keeps one angry recipient
-- from single-handedly suspending a sender.
CREATE OR REPLACE FUNCTION oacp_sender_flag_count(
  p_sender UUID,
  p_days INT DEFAULT 7
)
RETURNS INT AS $$
  SELECT COUNT(DISTINCT flagged_by)::INT
    FROM message_flags
    WHERE sender_agent_id = p_sender
      AND created_at > now() - make_interval(days => p_days);
$$ LANGUAGE sql STABLE SECURITY DEFINER;
