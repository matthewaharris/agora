-- RFC 009: an agent can remove itself from the registry.
--
-- Messages belong to both parties, so a departing agent that shares history
-- with a registered agent is kept as a tombstone (agent_id, name, public_key)
-- and hidden from every public read. An agent with no such history is deleted
-- outright, and so is any earlier tombstone that this leaves with nobody to
-- answer to.

-- ── A fourth status ───────────────────────────────────────────────────────
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_status_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_status_check
  CHECK (status IN ('online', 'offline', 'busy', 'deregistered'));

-- ── Tombstones are never publicly readable ────────────────────────────────
-- The dashboard and landing page read this table directly, so the rule lives
-- here rather than in each of them.
DROP POLICY IF EXISTS "agents_public_read" ON agents;
CREATE POLICY "agents_public_read"
  ON agents FOR SELECT
  USING (status <> 'deregistered');

-- ── Helpers ───────────────────────────────────────────────────────────────

-- Whether any agent still registered holds a message exchanged with this one.
CREATE OR REPLACE FUNCTION oacp_agent_has_live_counterpart(p_agent_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM messages m
    JOIN agents a
      ON a.agent_id = CASE WHEN m.sender_agent_id = p_agent_id
                           THEN m.recipient_agent_id ELSE m.sender_agent_id END
    WHERE (m.sender_agent_id = p_agent_id OR m.recipient_agent_id = p_agent_id)
      AND a.agent_id <> p_agent_id
      AND a.status <> 'deregistered'
  );
$$;

-- Delete an agent row and everything that hangs off it. Escrow rows have no
-- delete rule, so the caller must have checked there are none.
CREATE OR REPLACE FUNCTION oacp_delete_agent_row(p_agent_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_threads TEXT[];
BEGIN
  -- The agent's threads, noted before its messages go with it.
  SELECT array_agg(DISTINCT correlation_id::text) INTO v_threads
    FROM messages
   WHERE (sender_agent_id = p_agent_id OR recipient_agent_id = p_agent_id)
     AND correlation_id IS NOT NULL;

  -- thread_states has no delete rule either, so detach before deleting.
  UPDATE thread_states SET set_by_agent_id = NULL WHERE set_by_agent_id = p_agent_id;
  DELETE FROM agents WHERE agent_id = p_agent_id;

  -- Drop the state of every thread that no longer has a message, whoever set
  -- it: the other party may be a tombstone that outlives this delete.
  DELETE FROM thread_states ts
   WHERE (ts.correlation_id = ANY (coalesce(v_threads, '{}'::text[])) OR ts.set_by_agent_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.correlation_id::text = ts.correlation_id);
END;
$$;

-- ── Deregister ────────────────────────────────────────────────────────────
-- Authentication (registry token and key signature) is done by the caller.
-- Returns {"outcome": "deleted" | "tombstoned", "tombstones_removed": n}
-- or {"error": "not_found" | "escrow_open"}.
CREATE OR REPLACE FUNCTION oacp_deregister_agent(p_agent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_peers   UUID[];
  v_peer    UUID;
  v_removed INT := 0;
BEGIN
  -- One deregistration at a time. Without this, two agents that only know
  -- each other could leave at the same moment, each see the other as still
  -- registered, and both be kept as tombstones for ever.
  PERFORM pg_advisory_xact_lock(hashtext('oacp_deregister_agent'));

  SELECT status INTO v_status FROM agents WHERE agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND OR v_status = 'deregistered' THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM escrow
     WHERE status = 'held' AND (requester_id = p_agent_id OR provider_id = p_agent_id)
  ) THEN
    RETURN jsonb_build_object('error', 'escrow_open');
  END IF;

  -- Keep a tombstone when a registered agent still holds shared messages, or
  -- when settled escrow rows still name this agent.
  IF oacp_agent_has_live_counterpart(p_agent_id)
     OR EXISTS (SELECT 1 FROM escrow WHERE requester_id = p_agent_id OR provider_id = p_agent_id)
  THEN
    UPDATE agents
       SET status = 'deregistered',
           registry_token = NULL,
           owner_id = NULL,
           handle = NULL,
           owner_handle = NULL,
           description = '',
           endpoint_url = NULL,
           capabilities = '{}',
           metadata = '{}'
     WHERE agent_id = p_agent_id;

    DELETE FROM friendships     WHERE agent_lo = p_agent_id OR agent_hi = p_agent_id;
    DELETE FROM friend_codes    WHERE issuer_agent_id = p_agent_id;
    DELETE FROM contacts        WHERE recipient_agent_id = p_agent_id OR sender_agent_id = p_agent_id;
    DELETE FROM webhooks        WHERE agent_id = p_agent_id;
    DELETE FROM team_members    WHERE agent_id = p_agent_id;
    DELETE FROM approval_tokens WHERE agent_id = p_agent_id OR subject_id = p_agent_id;
    DELETE FROM balances        WHERE agent_id = p_agent_id;

    RETURN jsonb_build_object('outcome', 'tombstoned', 'tombstones_removed', 0);
  END IF;

  -- Nobody registered shares history with this agent: delete it outright.
  -- Remember its tombstoned counterparts first; they may now be alone.
  SELECT array_agg(DISTINCT a.agent_id) INTO v_peers
    FROM messages m
    JOIN agents a
      ON a.agent_id = CASE WHEN m.sender_agent_id = p_agent_id
                           THEN m.recipient_agent_id ELSE m.sender_agent_id END
   WHERE (m.sender_agent_id = p_agent_id OR m.recipient_agent_id = p_agent_id)
     AND a.agent_id <> p_agent_id
     AND a.status = 'deregistered';

  PERFORM oacp_delete_agent_row(p_agent_id);

  FOREACH v_peer IN ARRAY coalesce(v_peers, '{}'::uuid[]) LOOP
    IF NOT oacp_agent_has_live_counterpart(v_peer)
       AND NOT EXISTS (SELECT 1 FROM escrow WHERE requester_id = v_peer OR provider_id = v_peer)
    THEN
      PERFORM oacp_delete_agent_row(v_peer);
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('outcome', 'deleted', 'tombstones_removed', v_removed);
END;
$$;

-- Only the registry's own service role may call these.
REVOKE ALL ON FUNCTION oacp_agent_has_live_counterpart(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION oacp_delete_agent_row(UUID)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION oacp_deregister_agent(UUID)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION oacp_agent_has_live_counterpart(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION oacp_delete_agent_row(UUID)           TO service_role;
GRANT EXECUTE ON FUNCTION oacp_deregister_agent(UUID)           TO service_role;
