-- OACP Token Economy
-- Balances, transactions, and atomic transfer function
-- Decision D007: Supabase-based ledger, blockchain deferred

-- ============================================================
-- Balances table — one row per agent
-- ============================================================
CREATE TABLE balances (
  agent_id    UUID PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
  balance     BIGINT NOT NULL DEFAULT 0
              CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Realtime for dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE balances;

COMMENT ON TABLE balances IS 'OACP token balances — agents earn by completing tasks, spend by requesting tasks';

-- ============================================================
-- Transactions table — immutable audit log
-- ============================================================
CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id   UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  to_agent_id     UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  type            TEXT NOT NULL
                  CHECK (type IN ('task_payment', 'starting_grant', 'manual_credit', 'manual_debit')),
  message_id      UUID REFERENCES messages(message_id) ON DELETE SET NULL,
  description     TEXT DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX idx_transactions_from ON transactions (from_agent_id, created_at DESC);
CREATE INDEX idx_transactions_to ON transactions (to_agent_id, created_at DESC);
CREATE INDEX idx_transactions_message ON transactions (message_id) WHERE message_id IS NOT NULL;

COMMENT ON TABLE transactions IS 'OACP token transaction ledger — immutable audit log of all transfers';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Public read for balances (anyone can see agent balances)
CREATE POLICY "balances_public_read" ON balances FOR SELECT USING (true);
CREATE POLICY "balances_service_all" ON balances FOR ALL USING (true) WITH CHECK (true);

-- Public read for transactions
CREATE POLICY "transactions_public_read" ON transactions FOR SELECT USING (true);
CREATE POLICY "transactions_service_all" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Atomic transfer function
-- Uses SELECT FOR UPDATE to prevent race conditions
-- ============================================================
CREATE OR REPLACE FUNCTION oacp_transfer(
  p_from_agent_id UUID,
  p_to_agent_id   UUID,
  p_amount         BIGINT,
  p_type           TEXT DEFAULT 'task_payment',
  p_message_id     UUID DEFAULT NULL,
  p_description    TEXT DEFAULT ''
)
RETURNS UUID AS $$
DECLARE
  v_from_balance BIGINT;
  v_tx_id UUID;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive, got %', p_amount;
  END IF;

  -- Lock sender's balance row (prevents concurrent overdraw)
  SELECT balance INTO v_from_balance
  FROM balances
  WHERE agent_id = p_from_agent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender agent % has no balance record', p_from_agent_id;
  END IF;

  -- Check sufficient funds
  IF v_from_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: has %, needs %', v_from_balance, p_amount;
  END IF;

  -- Debit sender
  UPDATE balances
  SET balance = balance - p_amount, updated_at = now()
  WHERE agent_id = p_from_agent_id;

  -- Credit recipient (create row if not exists)
  INSERT INTO balances (agent_id, balance, updated_at)
  VALUES (p_to_agent_id, p_amount, now())
  ON CONFLICT (agent_id)
  DO UPDATE SET balance = balances.balance + p_amount, updated_at = now();

  -- Record transaction
  INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, message_id, description)
  VALUES (p_from_agent_id, p_to_agent_id, p_amount, p_type, p_message_id, p_description)
  RETURNING id INTO v_tx_id;

  RAISE LOG '[OACP] Transfer: % tokens from % to % (tx: %)', p_amount, p_from_agent_id, p_to_agent_id, v_tx_id;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Starting balance grant (idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION oacp_grant_starting_balance(p_agent_id UUID, p_amount BIGINT DEFAULT 1000)
RETURNS VOID AS $$
BEGIN
  -- Only grant if no balance record exists yet
  INSERT INTO balances (agent_id, balance, updated_at)
  VALUES (p_agent_id, p_amount, now())
  ON CONFLICT (agent_id) DO NOTHING;

  -- Record the grant (only if row was actually inserted)
  IF FOUND THEN
    INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, description)
    VALUES (NULL, p_agent_id, p_amount, 'starting_grant', 'New agent starting balance');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Auto-grant on agent registration
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_grant_starting_balance()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM oacp_grant_starting_balance(NEW.agent_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER agents_starting_balance
  AFTER INSERT ON agents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_grant_starting_balance();

COMMENT ON FUNCTION oacp_transfer IS 'Atomic token transfer between agents with row-level locking';
COMMENT ON FUNCTION oacp_grant_starting_balance IS 'Grant starting tokens to new agents (idempotent)';

-- ============================================================
-- Grant starting balance to any existing agents
-- ============================================================
INSERT INTO balances (agent_id, balance, updated_at)
SELECT agent_id, 1000, now()
FROM agents
WHERE agent_id NOT IN (SELECT agent_id FROM balances)
ON CONFLICT DO NOTHING;
