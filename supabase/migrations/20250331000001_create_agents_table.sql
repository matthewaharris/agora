-- OACP Agents Table
-- Stores Agent Cards for all registered OACP agents
-- REQ-REG-01 through REQ-REG-04, REQ-HB-01 through REQ-HB-03, REQ-DISC-01 through REQ-DISC-03

-- ============================================================
-- Updated-at trigger function (reusable)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Agents table
-- ============================================================
CREATE TABLE agents (
  agent_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  owner_handle   TEXT,
  description    TEXT DEFAULT '',
  endpoint_url   TEXT,

  -- Capabilities: array of string tags for GIN-indexed discovery
  capabilities   TEXT[] NOT NULL DEFAULT '{}',

  -- Status: online, offline, busy — with CHECK constraint
  status         TEXT NOT NULL DEFAULT 'offline'
                 CHECK (status IN ('online', 'offline', 'busy')),

  -- Ed25519 public key (hex-encoded) — required for identity verification
  public_key     TEXT NOT NULL,

  -- Protocols this agent supports (future A2A bridge)
  protocols_supported TEXT[] NOT NULL DEFAULT '{oacp/v1}',

  -- Flexible metadata bag for agent-specific extensions
  metadata       JSONB NOT NULL DEFAULT '{}',

  -- Registry token for authenticated operations (hashed)
  registry_token TEXT,

  -- Heartbeat: last time the agent was seen alive
  last_seen_at   TIMESTAMPTZ,

  -- Timestamps
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- GIN index on capabilities for discovery queries (REQ-DISC-01)
CREATE INDEX idx_agents_capabilities ON agents USING GIN (capabilities);

-- Status index for filtering online/offline/busy
CREATE INDEX idx_agents_status ON agents (status);

-- Owner handle for filtering by owner
CREATE INDEX idx_agents_owner ON agents (owner_handle) WHERE owner_handle IS NOT NULL;

-- ============================================================
-- Trigger: auto-update updated_at on row change
-- ============================================================
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Public read: anyone can discover agents (discovery is public)
CREATE POLICY "agents_public_read"
  ON agents FOR SELECT
  USING (true);

-- Service role can do anything (Edge Functions use service_role key)
CREATE POLICY "agents_service_all"
  ON agents FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Enable Realtime for status changes (REQ-HB-03)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE agents;

-- ============================================================
-- Comments for documentation
-- ============================================================
COMMENT ON TABLE agents IS 'OACP Agent Registry — stores Agent Cards with capabilities and presence state';
COMMENT ON COLUMN agents.agent_id IS 'Unique OACP agent identifier (UUID v4)';
COMMENT ON COLUMN agents.capabilities IS 'Array of capability tags for discovery (e.g., research-summarization)';
COMMENT ON COLUMN agents.public_key IS 'Ed25519 public key in hex encoding for message signature verification';
COMMENT ON COLUMN agents.registry_token IS 'Hashed bearer token for authenticated agent operations';
COMMENT ON COLUMN agents.last_seen_at IS 'Last heartbeat timestamp — agents offline after 90s silence';
