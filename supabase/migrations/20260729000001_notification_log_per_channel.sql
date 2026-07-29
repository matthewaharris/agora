-- Fix: the notification dedupe index collided across channels.
--
-- idx_notification_log_dedupe was UNIQUE on (owner_id, event, dedupe_key)
-- for sent rows. One notification fans out to every verified channel, so the
-- first channel's row inserted and every subsequent channel's row violated
-- the index and was silently dropped. The message was still delivered — only
-- the audit trail was lost, which is the worst way to be wrong: dispatch
-- looked like it never happened.
--
-- Dedupe is meant to stop the same event nagging twice, not to stop the same
-- event reaching email AND Telegram. Scope it per channel.

DROP INDEX IF EXISTS idx_notification_log_dedupe;

CREATE UNIQUE INDEX idx_notification_log_dedupe
  ON notification_log (owner_id, event, dedupe_key, channel_id)
  WHERE dedupe_key IS NOT NULL AND status = 'sent';
