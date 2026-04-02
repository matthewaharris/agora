-- OACP Task Escrow
-- Holds tokens during task execution, releases on completion or refunds on failure

CREATE TABLE escrow (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      UUID NOT NULL REFERENCES agents(agent_id),
  provider_id       UUID NOT NULL REFERENCES agents(agent_id),
  amount            BIGINT NOT NULL CHECK (amount > 0),
  message_id        UUID REFERENCES messages(message_id),
  status            TEXT NOT NULL DEFAULT 'held'
                    CHECK (status IN ('held', 'released', 'refunded', 'expired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

CREATE INDEX idx_escrow_requester ON escrow (requester_id) WHERE status = 'held';
CREATE INDEX idx_escrow_provider ON escrow (provider_id) WHERE status = 'held';
CREATE INDEX idx_escrow_message ON escrow (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_escrow_expires ON escrow (expires_at) WHERE status = 'held';

-- Function: hold tokens in escrow (debit requester)
CREATE OR REPLACE FUNCTION oacp_escrow_hold(
  p_requester_id UUID,
  p_provider_id UUID,
  p_amount BIGINT,
  p_message_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_balance BIGINT;
  v_escrow_id UUID;
BEGIN
  -- Lock requester balance
  SELECT balance INTO v_balance FROM balances
  WHERE agent_id = p_requester_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Requester has no balance'; END IF;
  IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance: has %, needs %', v_balance, p_amount; END IF;

  -- Debit requester
  UPDATE balances SET balance = balance - p_amount, updated_at = now()
  WHERE agent_id = p_requester_id;

  -- Create escrow record
  INSERT INTO escrow (requester_id, provider_id, amount, message_id)
  VALUES (p_requester_id, p_provider_id, p_amount, p_message_id)
  RETURNING id INTO v_escrow_id;

  RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: release escrow (pay provider)
CREATE OR REPLACE FUNCTION oacp_escrow_release(p_escrow_id UUID)
RETURNS VOID AS $$
DECLARE
  v_escrow escrow%ROWTYPE;
BEGIN
  SELECT * INTO v_escrow FROM escrow WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escrow not found or already resolved'; END IF;

  -- Credit provider
  INSERT INTO balances (agent_id, balance, updated_at) VALUES (v_escrow.provider_id, v_escrow.amount, now())
  ON CONFLICT (agent_id) DO UPDATE SET balance = balances.balance + v_escrow.amount, updated_at = now();

  -- Record transaction
  INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, message_id, description)
  VALUES (v_escrow.requester_id, v_escrow.provider_id, v_escrow.amount, 'task_payment', v_escrow.message_id, 'Escrow released');

  -- Mark resolved
  UPDATE escrow SET status = 'released', resolved_at = now() WHERE id = p_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: refund escrow (return to requester)
CREATE OR REPLACE FUNCTION oacp_escrow_refund(p_escrow_id UUID)
RETURNS VOID AS $$
DECLARE
  v_escrow escrow%ROWTYPE;
BEGIN
  SELECT * INTO v_escrow FROM escrow WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escrow not found or already resolved'; END IF;

  -- Credit requester back
  UPDATE balances SET balance = balance + v_escrow.amount, updated_at = now()
  WHERE agent_id = v_escrow.requester_id;

  -- Mark refunded
  UPDATE escrow SET status = 'refunded', resolved_at = now() WHERE id = p_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: expire old escrows (called by cron)
CREATE OR REPLACE FUNCTION oacp_expire_escrows()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  -- Refund all expired held escrows
  WITH expired AS (
    SELECT id FROM escrow WHERE status = 'held' AND expires_at < now()
  )
  SELECT count(*) INTO v_count FROM expired;

  -- Refund each one
  PERFORM oacp_escrow_refund(id) FROM escrow WHERE status = 'held' AND expires_at < now();

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE escrow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow_public_read" ON escrow FOR SELECT USING (true);
CREATE POLICY "escrow_service_all" ON escrow FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE escrow IS 'OACP Escrow — holds tokens during task execution with timeout-based auto-refund';
