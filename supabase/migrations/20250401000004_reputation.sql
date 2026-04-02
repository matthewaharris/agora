-- OACP Reputation System
-- Tracks agent reliability based on task completion history

CREATE TABLE reputation (
  agent_id         UUID PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
  score            REAL NOT NULL DEFAULT 0.5,  -- 0.0 to 1.0
  tasks_completed  INT NOT NULL DEFAULT 0,
  tasks_failed     INT NOT NULL DEFAULT 0,
  avg_response_ms  INT DEFAULT NULL,
  total_uptime_s   BIGINT NOT NULL DEFAULT 0,
  last_computed    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE reputation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reputation_public_read" ON reputation FOR SELECT USING (true);
CREATE POLICY "reputation_service_all" ON reputation FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE reputation;

-- Function to update reputation after a task completes
CREATE OR REPLACE FUNCTION oacp_update_reputation(
  p_agent_id UUID,
  p_completed BOOLEAN,
  p_response_ms INT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_total INT;
  v_completed INT;
BEGIN
  -- Upsert reputation record
  INSERT INTO reputation (agent_id) VALUES (p_agent_id)
  ON CONFLICT (agent_id) DO NOTHING;

  IF p_completed THEN
    UPDATE reputation
    SET tasks_completed = tasks_completed + 1,
        avg_response_ms = CASE
          WHEN avg_response_ms IS NULL THEN p_response_ms
          WHEN p_response_ms IS NOT NULL THEN (avg_response_ms + p_response_ms) / 2
          ELSE avg_response_ms
        END,
        last_computed = now()
    WHERE agent_id = p_agent_id;
  ELSE
    UPDATE reputation
    SET tasks_failed = tasks_failed + 1,
        last_computed = now()
    WHERE agent_id = p_agent_id;
  END IF;

  -- Recompute score
  SELECT tasks_completed, tasks_completed + tasks_failed INTO v_completed, v_total
  FROM reputation WHERE agent_id = p_agent_id;

  UPDATE reputation
  SET score = CASE
    WHEN v_total = 0 THEN 0.5
    ELSE LEAST(1.0, GREATEST(0.0, v_completed::real / v_total::real))
  END
  WHERE agent_id = p_agent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE reputation IS 'OACP agent reputation — tracks reliability, completion rate, and response time';
