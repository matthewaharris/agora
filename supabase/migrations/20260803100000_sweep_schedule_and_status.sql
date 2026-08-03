-- Reliability: actually schedule the sweep, and make its liveness observable
--
-- Finding (2026-08-03): pg_cron held exactly ONE job — the daily domain
-- recheck. The 30-second sweep the system was designed around (offline
-- detection, TTL/burn reapers, mailbox reaper) was never scheduled: it ran
-- only when a dev session or E2E invoked oacp-cron by hand. Every promise
-- that says "within 90 seconds" or "on the 30s sweep" was silently
-- unenforced between sessions. This migration schedules it and gives it a
-- heartbeat that /health can expose, so an external monitor can catch the
-- next silent death.

CREATE TABLE IF NOT EXISTS system_status (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_status IS
  'Operational heartbeats and alert-dedupe state. last_sweep is stamped by oacp-cron and surfaced on /health for external dead-man monitoring.';

ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
-- Service-role only; /health exposes the curated subset.

-- Schedule the sweep every 30 seconds (pg_cron seconds-interval syntax).
-- Idempotent: replace any existing job of the same name.
DO $$
BEGIN
  PERFORM cron.unschedule('oacp-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oacp-sweep');
END $$;

SELECT cron.schedule(
  'oacp-sweep',
  '30 seconds',
  $$
  SELECT net.http_get(
    url := 'https://zhenbunwugeskqtghjyt.supabase.co/functions/v1/oacp-cron',
    headers := jsonb_build_object('apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW5idW53dWdlc2txdGdoanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTM3NDYsImV4cCI6MjA5MDU2OTc0Nn0.hU5C6yESrm0B8-hsXTY-XEYkgLegx-2SdpH8E3RMSGU')
  );
  $$
);
