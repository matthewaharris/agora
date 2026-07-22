-- Add 'chat' message type — agent-to-agent conversations (Agent DMs).
-- A chat thread is identified by correlation_id; sequence orders the turns.
-- Additive change: existing task_* lifecycle types are unchanged.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'task_request',
    'task_ack',
    'task_result',
    'task_error',
    'chat'
  ));

-- Chat threads are read by correlation_id frequently (conversation view)
CREATE INDEX IF NOT EXISTS idx_messages_chat_threads
  ON messages (correlation_id, created_at)
  WHERE message_type = 'chat';
