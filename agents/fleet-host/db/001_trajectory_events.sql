-- Trajectory store for the fleet host (docs/decisions/002-trajectories.md).
--
-- This runs in the fleet host's OWN database, not the registry's. The registry
-- is a notary that holds digests; this database holds what agents actually
-- read and wrote, and belongs to the agents' owner. Apply it by hand in the
-- SQL editor of the trajectory project. It is safe to run more than once.
--
-- Append-only: rows are inserted and never changed, with one exception. After
-- content_expires_at the content column is set to NULL, leaving the measured
-- facts in attrs.

CREATE TABLE IF NOT EXISTS trajectory_events (
  run_id UUID NOT NULL,
  -- Position in the run, starting at 1.
  seq INT NOT NULL CHECK (seq > 0),
  -- W3C trace ID, shared by every run that belongs to one piece of work.
  trace_id TEXT NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  -- The run that caused this one, when the task came from another agent's run.
  parent_run_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'run.started', 'model.turn', 'tool.call', 'limit.hit', 'run.ended', 'policy.applied'
  )),
  -- Measured facts: names, timings, token counts. Kept.
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- What was said: prompts, model output, tool results. Can be other people's
  -- code, so it is removed after content_expires_at.
  content JSONB,
  content_expires_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

COMMENT ON TABLE trajectory_events IS
  'Append-only record of agent runs. One row per event; content expires, attrs stay.';

CREATE INDEX IF NOT EXISTS idx_trajectory_events_trace ON trajectory_events (trace_id);
CREATE INDEX IF NOT EXISTS idx_trajectory_events_ts ON trajectory_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_trajectory_events_expiry
  ON trajectory_events (content_expires_at) WHERE content IS NOT NULL;

-- Only the service role may touch this table. RLS with no policies shuts out
-- the anon and authenticated roles.
ALTER TABLE trajectory_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trajectory_events FROM anon, authenticated;

-- Append-only is enforced in the database, so it holds even for the service
-- role and for a bug in the host. No deletes. The only update allowed is
-- clearing content.
--
-- This stops mistakes and misused application credentials. It does not stop
-- the database owner, who can drop the triggers.
CREATE OR REPLACE FUNCTION trajectory_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'trajectory_events is append-only: the table cannot be emptied';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trajectory_events is append-only: rows cannot be deleted';
  END IF;
  IF NEW.content IS NOT NULL
     OR (to_jsonb(NEW) - 'content') IS DISTINCT FROM (to_jsonb(OLD) - 'content') THEN
    RAISE EXCEPTION 'trajectory_events is append-only: only content may be cleared';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trajectory_events_append_only ON trajectory_events;
CREATE TRIGGER trajectory_events_append_only
  BEFORE UPDATE OR DELETE ON trajectory_events
  FOR EACH ROW EXECUTE FUNCTION trajectory_events_append_only();

-- TRUNCATE does not fire row triggers, so it needs its own.
DROP TRIGGER IF EXISTS trajectory_events_no_truncate ON trajectory_events;
CREATE TRIGGER trajectory_events_no_truncate
  BEFORE TRUNCATE ON trajectory_events
  FOR EACH STATEMENT EXECUTE FUNCTION trajectory_events_append_only();

-- Daily jobs. pg_cron keeps one row per job run and never removes them, which
-- is what filled the registry database in November 2026, so its history is
-- purged here too.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('trajectory-content-expiry', 'trajectory-cron-history-cleanup');
END $$;

SELECT cron.schedule(
  'trajectory-content-expiry',
  '41 3 * * *',
  $$UPDATE trajectory_events SET content = NULL
    WHERE content IS NOT NULL AND content_expires_at < now();$$
);

SELECT cron.schedule(
  'trajectory-cron-history-cleanup',
  '47 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days'
       OR (end_time IS NULL AND start_time < now() - interval '2 days');$$
);
