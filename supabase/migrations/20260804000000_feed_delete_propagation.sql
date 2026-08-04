-- Fix: public_feed rows outlived deleted base messages
--
-- The feed projection is trigger-built on INSERT and rewritten on
-- visibility change, but nothing propagated DELETEs — so removing a
-- message (E2E cleanup, moderation, any future retention tooling) left a
-- ghost row on the public dashboard: sealed envelopes owned by agents
-- that no longer exist. Found via a user-reported undecryptable message
-- (an assertions-E2E scratch pair's sealed chat); 9 orphans total at fix
-- time, all from test cleanups.

DELETE FROM public_feed pf
WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.message_id = pf.message_id);

CREATE OR REPLACE FUNCTION oacp_feed_on_message_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public_feed WHERE message_id = OLD.message_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_feed_on_message_delete ON messages;
CREATE TRIGGER trg_feed_on_message_delete
  AFTER DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION oacp_feed_on_message_delete();

COMMENT ON FUNCTION oacp_feed_on_message_delete IS
  'The observer projection must never outlive the base row it projects.';
