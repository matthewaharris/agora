-- Reliability: stop the sweep's own bookkeeping from exhausting disk IO
--
-- Finding (2026-11-19, during a registry stall with Supabase's "about to
-- deplete its Disk IO Budget" banner showing): requests to /health took 90
-- seconds or timed out, and new database connections were refused. Over the
-- preceding 3.5 days one statement accounted for 94.5% of all query time:
-- pg_net's own cleanup of net._http_response, 15,835 runs at about 3 seconds
-- each. That table was 12 MB while holding 169 rows. 46 of the last 169 sweep
-- calls had timed out.
--
-- The chain: the 30-second sweep (20260803100000) calls oacp-cron through
-- pg_net, pg_net stores every response for 6 hours, and its worker scans the
-- whole table on each pass to delete expired rows.
--
-- Not done here: shortening pg_net.ttl. On hosted Supabase that needs
-- ALTER SYSTEM, which the postgres role does not hold (Supabase support has
-- to grant it).

-- 1. Return the dead space. Nothing reads these rows; the sweep's liveness
--    is system_status.last_sweep. The table is unlogged, so this is cheap.
TRUNCATE net._http_response;

-- 2. Run the sweep every 2 minutes instead of every 30 seconds. Offline
--    detection and the TTL/burn reapers can now lag by up to 2 minutes.
--    Restore '30 seconds' once the database has the IO headroom for it.
--    alter_job keeps the existing command, so the job's URL and key are not
--    repeated here.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'oacp-sweep'),
  schedule := '*/2 * * * *'
);
