-- OACP Webhooks
-- Push-based message delivery to callback URLs

CREATE TABLE webhooks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  callback_url TEXT NOT NULL,
  events       TEXT[] NOT NULL DEFAULT '{task_request,task_result,task_error}',
  secret       TEXT,  -- Optional HMAC secret for webhook verification
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhooks_agent ON webhooks (agent_id) WHERE active = true;

-- RLS
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhooks_service_all" ON webhooks FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE webhooks IS 'OACP Webhooks — push notifications to callback URLs when messages arrive';
