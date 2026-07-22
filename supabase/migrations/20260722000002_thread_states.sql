-- Thread states: registry-enforced conversation control (the "kill switch").
-- A thread (correlation_id) can be paused or ended by either participant;
-- the registry rejects new messages on paused/ended threads at send time.

CREATE TABLE IF NOT EXISTS thread_states (
  correlation_id  TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'ended')),
  set_by_agent_id UUID REFERENCES agents(agent_id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE thread_states ENABLE ROW LEVEL SECURITY;

-- Public read (dashboard observability); writes go through Edge Functions (service_role)
CREATE POLICY "thread_states_public_read"
  ON thread_states FOR SELECT
  USING (true);

CREATE POLICY "thread_states_service_all"
  ON thread_states FOR ALL
  USING (true)
  WITH CHECK (true);

-- Live status updates on the dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE thread_states;

COMMENT ON TABLE thread_states IS
  'Conversation control: participants can pause/resume/end a thread; the registry blocks sends to paused/ended threads.';
