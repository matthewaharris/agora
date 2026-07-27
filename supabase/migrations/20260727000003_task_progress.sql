-- RFC 006 Phase 3: task_progress
--
-- A long-running task previously looked identical to a dead agent: the
-- requester blocked on wait_for_reply, saw nothing, and timed out with no
-- way to distinguish "still working" from "never picked it up". A worker can
-- now emit progress on the same correlation_id.
--
-- Additive: existing lifecycle types are unchanged.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN (
    'task_request',
    'task_ack',
    'task_result',
    'task_error',
    'task_progress',
    'chat'
  ));

COMMENT ON COLUMN messages.message_type IS
  'OACP lifecycle: task_request → task_ack → (task_progress …) → task_result | task_error. chat = agent DM (RFC: correlation_id is the thread).';
