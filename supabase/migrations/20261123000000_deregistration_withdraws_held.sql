-- RFC 009 §3: a message that was never delivered is not shared history.
--
-- A message from an unknown sender is held (RFC 005) until the recipient
-- accepts the sender. Until then the recipient has not received it. A departing
-- agent's held messages were counted as shared history, so an agent whose only
-- messages were held was kept as a tombstone for nothing.
--
-- Deregistration now withdraws the departing agent's own undelivered messages
-- first. Held messages it *received* are untouched: they are the sender's record.
--
-- The tombstone sweep now covers every tombstone, on both outcomes. Before, only
-- the departing agent's own counterparts were checked, and only when it was
-- deleted, so a tombstone kept for another tombstone could be left for ever.

CREATE OR REPLACE FUNCTION oacp_deregister_agent(p_agent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_peer    UUID;
  v_removed INT := 0;
  v_threads TEXT[];
  v_outcome TEXT;
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

  -- Withdraw what this agent sent that was never delivered. A held message
  -- (RFC 005) has not reached its recipient, so it is nobody else's record.
  WITH gone AS (
    DELETE FROM messages
     WHERE sender_agent_id = p_agent_id AND delivery_status = 'quarantined'
    RETURNING correlation_id
  )
  SELECT array_agg(DISTINCT correlation_id::text) INTO v_threads
    FROM gone WHERE correlation_id IS NOT NULL;

  DELETE FROM thread_states ts
   WHERE ts.correlation_id = ANY (coalesce(v_threads, '{}'::text[]))
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.correlation_id::text = ts.correlation_id);

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

    v_outcome := 'tombstoned';
  ELSE
    -- Nobody registered shares history with this agent: delete it outright.
    PERFORM oacp_delete_agent_row(p_agent_id);
    v_outcome := 'deleted';
  END IF;

  -- Sweep every earlier tombstone this departure leaves with nobody to answer
  -- to. Checking all of them, not just this agent's counterparts, also clears
  -- chains: a tombstone kept only for another tombstone.
  FOR v_peer IN
    SELECT agent_id FROM agents WHERE status = 'deregistered' AND agent_id <> p_agent_id
  LOOP
    IF NOT oacp_agent_has_live_counterpart(v_peer)
       AND NOT EXISTS (SELECT 1 FROM escrow WHERE requester_id = v_peer OR provider_id = v_peer)
    THEN
      PERFORM oacp_delete_agent_row(v_peer);
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('outcome', v_outcome, 'tombstones_removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION oacp_deregister_agent(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION oacp_deregister_agent(UUID) TO service_role;
