-- OACP Auto-Offline Detection
-- REQ-HB-02: Set status = 'offline' for agents that haven't heartbeated in 90 seconds
--
-- This creates a Postgres function that can be called by:
--   1. Supabase pg_cron (production) — runs every 30 seconds
--   2. A Supabase Edge Function on a schedule (alternative)
--   3. Manual invocation via SELECT oacp_mark_offline_agents()

-- ============================================================
-- Function: Mark stale agents as offline
-- ============================================================
CREATE OR REPLACE FUNCTION oacp_mark_offline_agents()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE agents
  SET status = 'offline'
  WHERE status IN ('online', 'busy')
    AND last_seen_at IS NOT NULL
    AND last_seen_at < now() - interval '90 seconds';

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Log if any agents were marked offline (visible in Supabase logs)
  IF affected > 0 THEN
    RAISE LOG '[OACP] Marked % agent(s) as offline due to heartbeat timeout', affected;
  END IF;

  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION oacp_mark_offline_agents IS
  'Marks agents offline if no heartbeat received within 90 seconds. Call on a schedule.';

-- ============================================================
-- pg_cron schedule (requires pg_cron extension)
-- Note: pg_cron is available on Supabase Pro plan.
-- On free tier, use the Edge Function cron alternative below.
-- ============================================================
-- To enable (run manually on Supabase Dashboard SQL editor if on Pro):
--
-- SELECT cron.schedule(
--   'oacp-mark-offline',
--   '*/30 * * * * *',  -- every 30 seconds (cron doesn't support sub-minute; use pg_cron v1.6+)
--   'SELECT oacp_mark_offline_agents()'
-- );
--
-- For standard cron (minute-level):
-- SELECT cron.schedule(
--   'oacp-mark-offline',
--   '* * * * *',  -- every minute
--   'SELECT oacp_mark_offline_agents()'
-- );
