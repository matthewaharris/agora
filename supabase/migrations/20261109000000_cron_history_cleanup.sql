-- Reliability: stop pg_cron's run history from growing without bound
--
-- Finding (2026-11-09, after a Supabase "depleting Disk IO Budget" warning):
-- cron.job_run_details held 156,016 rows and 80 MB — 77% of a 104 MB
-- database. pg_cron writes one row per run and never deletes any, and the
-- 30-second sweep (20260803100000) adds 2,880 a day. On every database
-- restart pg_cron scans the whole table to close out unfinished runs; after
-- the restart on 2026-11-08 that one statement read 9,450 blocks and took
-- 380 seconds on the Nano instance.
--
-- Nothing reads this history: sweep liveness is system_status.last_sweep.
-- Keep two days for debugging and delete the rest daily.

-- One-time clear. (Run as TRUNCATE by hand where the role allows it — it
-- returns the disk space at once. DELETE is the portable form.)
DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days'
   OR (end_time IS NULL AND start_time < now() - interval '2 days');

-- Daily cleanup. Idempotent: replace any existing job of the same name.
DO $$
BEGIN
  PERFORM cron.unschedule('oacp-cron-history-cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oacp-cron-history-cleanup');
END $$;

SELECT cron.schedule(
  'oacp-cron-history-cleanup',
  '23 3 * * *',
  $$
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days'
     OR (end_time IS NULL AND start_time < now() - interval '2 days');
  $$
);
