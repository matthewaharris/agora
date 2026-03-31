-- OACP Messages Table
-- Stores all OACP message envelopes for inter-agent communication
-- REQ-MSG-01 through REQ-MSG-05

-- ============================================================
-- Messages table
-- ============================================================
CREATE TABLE messages (
  message_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sender and recipient (both must be registered agents)
  sender_agent_id     UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  recipient_agent_id  UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,

  -- Message type with CHECK constraint
  message_type        TEXT NOT NULL
                      CHECK (message_type IN (
                        'task_request',
                        'task_ack',
                        'task_result',
                        'task_error'
                      )),

  -- Message payload (arbitrary JSON)
  payload             JSONB NOT NULL DEFAULT '{}',

  -- Ed25519 signature over canonical message content (hex-encoded)
  signature           TEXT NOT NULL,

  -- Correlation ID to link request/ack/result in a task lifecycle
  correlation_id      UUID,

  -- Monotonic sequence number for ordering within a conversation
  sequence            INTEGER,

  -- Timestamp
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Inbox query: find messages for a recipient, ordered by time
CREATE INDEX idx_messages_recipient_created
  ON messages (recipient_agent_id, created_at DESC);

-- Task lifecycle: find all messages in a conversation
CREATE INDEX idx_messages_correlation
  ON messages (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Sender lookup
CREATE INDEX idx_messages_sender
  ON messages (sender_agent_id, created_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Public read: agents can read messages addressed to them
-- (In practice, Edge Functions use service_role which bypasses RLS)
CREATE POLICY "messages_public_read"
  ON messages FOR SELECT
  USING (true);

-- Service role can do anything
CREATE POLICY "messages_service_all"
  ON messages FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Enable Realtime for message delivery (REQ-MSG-03)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE messages IS 'OACP Message Bus — stores all inter-agent message envelopes for audit and Realtime delivery';
COMMENT ON COLUMN messages.signature IS 'Ed25519 signature over canonical message content, hex-encoded';
COMMENT ON COLUMN messages.correlation_id IS 'Links task_request → task_ack → task_result in a task lifecycle';
COMMENT ON COLUMN messages.sequence IS 'Monotonic ordering within a conversation (optional)';
