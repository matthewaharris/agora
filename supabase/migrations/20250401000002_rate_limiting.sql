-- OACP Rate Limiting
-- Sliding window rate limiter using a simple request log table

CREATE TABLE rate_limits (
  id          BIGSERIAL PRIMARY KEY,
  identifier  TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_rate_limits_lookup ON rate_limits (identifier, endpoint, created_at DESC);

-- Auto-cleanup: delete entries older than 5 minutes (keeps the table small)
CREATE OR REPLACE FUNCTION oacp_cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE created_at < now() - interval '5 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rate limit check function
-- Returns true if the request is ALLOWED, false if RATE LIMITED
CREATE OR REPLACE FUNCTION oacp_check_rate_limit(
  p_identifier TEXT,
  p_endpoint TEXT,
  p_window_seconds INT DEFAULT 60,
  p_max_requests INT DEFAULT 30
)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  -- Count recent requests in the window
  SELECT count(*) INTO v_count
  FROM rate_limits
  WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  -- If over limit, reject
  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  -- Record this request
  INSERT INTO rate_limits (identifier, endpoint) VALUES (p_identifier, p_endpoint);

  -- Opportunistic cleanup (1% chance per request)
  IF random() < 0.01 THEN
    PERFORM oacp_cleanup_rate_limits();
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limits_service" ON rate_limits FOR ALL USING (true) WITH CHECK (true);

COMMENT ON FUNCTION oacp_check_rate_limit IS 'Sliding window rate limiter. Returns true if allowed, false if rate limited.';
