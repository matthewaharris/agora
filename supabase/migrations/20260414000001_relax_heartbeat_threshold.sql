-- Relax offline threshold: 90s -> 180s
-- Heartbeat interval increased from 30s to 60s, so 90s was too tight
-- (one missed heartbeat = agent marked offline). 180s = 3 missed heartbeats.

CREATE OR REPLACE FUNCTION oacp_mark_offline_agents()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE agents
  SET status = 'offline'
  WHERE status IN ('online', 'busy')
    AND last_seen_at IS NOT NULL
    AND last_seen_at < now() - interval '180 seconds';

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected > 0 THEN
    RAISE LOG '[OACP] Marked % agent(s) as offline due to heartbeat timeout', affected;
  END IF;

  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION oacp_mark_offline_agents IS
  'Marks agents offline if no heartbeat received within 180 seconds. Call on a schedule.';
