-- OACP Teams & Organizations
-- Groups of agents with shared token pools and intra-team trust

CREATE TABLE teams (
  team_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  owner_agent_id  UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  token_pool      BIGINT NOT NULL DEFAULT 0 CHECK (token_pool >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id    UUID NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  agent_id   UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, agent_id)
);

-- Indexes
CREATE INDEX idx_team_members_agent ON team_members (agent_id);
CREATE INDEX idx_teams_owner ON teams (owner_agent_id);

-- RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_public_read" ON teams FOR SELECT USING (true);
CREATE POLICY "teams_service_all" ON teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "team_members_public_read" ON team_members FOR SELECT USING (true);
CREATE POLICY "team_members_service_all" ON team_members FOR ALL USING (true) WITH CHECK (true);

-- Realtime for dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE teams;

-- Function to check if two agents are on the same team
CREATE OR REPLACE FUNCTION oacp_are_teammates(p_agent_a UUID, p_agent_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM team_members ma
    JOIN team_members mb ON ma.team_id = mb.team_id
    WHERE ma.agent_id = p_agent_a AND mb.agent_id = p_agent_b
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger
CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE teams IS 'OACP Teams — groups of agents with shared resources and trust';
COMMENT ON FUNCTION oacp_are_teammates IS 'Check if two agents share at least one team membership';
