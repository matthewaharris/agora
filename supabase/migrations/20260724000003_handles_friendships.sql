-- RFC 002: Handles, friendships (friend codes), and access policy
--
-- Owner handles live on the RFC 003 owner record (owners.handle, already
-- unique). This migration adds per-agent handles, mutual friendship edges
-- established by single-use friend codes, and the registry-enforced
-- open/closed access policy.

-- ============================================================
-- 1. Agent handles + access policy
-- ============================================================
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS handle TEXT
    CHECK (handle ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$' OR handle ~ '^[a-z0-9]$'),
  ADD COLUMN IF NOT EXISTS access_policy TEXT NOT NULL DEFAULT 'open'
    CHECK (access_policy IN ('open', 'closed'));

-- Agent handles are unique within an owner's namespace (@matt/desktop)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_owner_handle_unique
  ON agents (owner_id, handle)
  WHERE owner_id IS NOT NULL AND handle IS NOT NULL;

COMMENT ON COLUMN agents.handle IS
  'RFC 002 agent handle, unique per owner: @<owners.handle>/<agents.handle>. Requires an attached owner account.';
COMMENT ON COLUMN agents.access_policy IS
  'RFC 002 §3.5: open = anyone may message this agent (pair rate limit applies to non-friends); closed = friends only, enforced at /messages/send.';

-- owners.handle format guard (column exists from RFC 003; add the grammar)
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_handle_format;
ALTER TABLE owners ADD CONSTRAINT owners_handle_format
  CHECK (handle IS NULL OR handle ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');

-- ============================================================
-- 2. Friendships: mutual edges with pinned keys
-- ============================================================
-- One row per pair; agent_lo < agent_hi keeps the pair canonical.
CREATE TABLE IF NOT EXISTS friendships (
  agent_lo       UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  agent_hi       UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  -- Public keys pinned at establishment time (RFC 002 §3: keys are truth)
  pinned_key_lo  TEXT NOT NULL,
  pinned_key_hi  TEXT NOT NULL,
  established_via TEXT NOT NULL DEFAULT 'code' CHECK (established_via IN ('code')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_lo, agent_hi),
  CHECK (agent_lo < agent_hi)
);

CREATE INDEX IF NOT EXISTS idx_friendships_hi ON friendships (agent_hi);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Edges are not public: signed-in owners see their own agents' friendships;
-- agents use the Edge Function API (service role).
CREATE POLICY "friendships_owner_read" ON friendships
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.owner_id = (SELECT auth.uid())
        AND (a.agent_id = friendships.agent_lo OR a.agent_id = friendships.agent_hi)
    )
  );

COMMENT ON TABLE friendships IS
  'RFC 002 §3.1: mutual agent friendships established by out-of-band friend codes, with both public keys pinned at establishment.';

-- ============================================================
-- 3. Friend codes: single-use out-of-band pairing
-- ============================================================
CREATE TABLE IF NOT EXISTS friend_codes (
  code               TEXT PRIMARY KEY,
  issuer_agent_id    UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  redeemed_by_agent_id UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  redeemed_at        TIMESTAMPTZ
);

ALTER TABLE friend_codes ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated access; the Edge Function (service role) brokers codes.

COMMENT ON TABLE friend_codes IS
  'RFC 002 §3.1: single-use pairing codes. The human relays the code out of band; redemption creates the friendship edge.';

-- ============================================================
-- 4. Public owner-handle lookup (dashboard)
-- ============================================================
-- owners stays closed (it holds emails); this view exposes exactly the
-- public part: which owner_id claimed which handle. Postgres views run
-- with the definer's privileges, so RLS on owners does not block it.
CREATE OR REPLACE VIEW public_owner_handles AS
  SELECT owner_id, handle FROM owners WHERE handle IS NOT NULL;

GRANT SELECT ON public_owner_handles TO anon, authenticated;
