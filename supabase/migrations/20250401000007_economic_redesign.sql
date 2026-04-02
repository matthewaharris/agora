-- OACP Economic Model Redesign
-- Tokens = actual LLM work. Agents earn by working. Daily free budgets.

-- 1. Reset all balances to 0 (remove the free 1000 starting balance)
UPDATE balances SET balance = 0, updated_at = now();

-- 2. Remove the auto-grant trigger (no more free starting balance)
DROP TRIGGER IF EXISTS agents_starting_balance ON agents;
DROP FUNCTION IF EXISTS trigger_grant_starting_balance();

-- Keep oacp_grant_starting_balance for manual grants but change default to 0
CREATE OR REPLACE FUNCTION oacp_grant_starting_balance(p_agent_id UUID, p_amount BIGINT DEFAULT 0)
RETURNS VOID AS $$
BEGIN
  INSERT INTO balances (agent_id, balance, updated_at)
  VALUES (p_agent_id, p_amount, now())
  ON CONFLICT (agent_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger with 0 starting balance (just creates the row)
CREATE OR REPLACE FUNCTION trigger_grant_starting_balance()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM oacp_grant_starting_balance(NEW.agent_id, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER agents_starting_balance
  AFTER INSERT ON agents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_grant_starting_balance();

-- 3. Add daily budget tracking to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_free_budget BIGINT DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS daily_budget_used BIGINT DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget_reset_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN agents.daily_free_budget IS 'Max LLM tokens this agent serves free per day (0 = unlimited free, set by agent owner)';
COMMENT ON COLUMN agents.daily_budget_used IS 'LLM tokens served today (resets daily)';

-- 4. Function to credit an agent for work done (proof-of-work earning)
CREATE OR REPLACE FUNCTION oacp_credit_work(
  p_agent_id UUID,
  p_tokens_used BIGINT,
  p_message_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT 'Proof-of-work: task completed'
)
RETURNS UUID AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  -- Credit the provider's balance
  INSERT INTO balances (agent_id, balance, updated_at)
  VALUES (p_agent_id, p_tokens_used, now())
  ON CONFLICT (agent_id)
  DO UPDATE SET balance = balances.balance + p_tokens_used, updated_at = now();

  -- Track daily budget usage
  -- Reset if it's a new day
  UPDATE agents
  SET daily_budget_used = CASE
    WHEN budget_reset_at < date_trunc('day', now()) THEN p_tokens_used
    ELSE daily_budget_used + p_tokens_used
  END,
  budget_reset_at = CASE
    WHEN budget_reset_at < date_trunc('day', now()) THEN now()
    ELSE budget_reset_at
  END
  WHERE agent_id = p_agent_id;

  -- Record transaction
  INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, message_id, description)
  VALUES (NULL, p_agent_id, p_tokens_used, 'task_payment', p_message_id, p_description)
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function to check if an agent has free budget remaining
CREATE OR REPLACE FUNCTION oacp_check_budget(p_agent_id UUID, p_estimated_tokens BIGINT DEFAULT 0)
RETURNS BOOLEAN AS $$
DECLARE
  v_budget BIGINT;
  v_used BIGINT;
  v_reset_at TIMESTAMPTZ;
BEGIN
  SELECT daily_free_budget, daily_budget_used, budget_reset_at
  INTO v_budget, v_used, v_reset_at
  FROM agents WHERE agent_id = p_agent_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- 0 budget means unlimited free
  IF v_budget = 0 THEN RETURN true; END IF;

  -- Reset if new day
  IF v_reset_at < date_trunc('day', now()) THEN
    v_used := 0;
  END IF;

  -- Check if enough budget remains
  RETURN (v_used + p_estimated_tokens) <= v_budget;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION oacp_credit_work IS 'Credit an agent with OACP tokens for LLM work done (proof-of-work)';
COMMENT ON FUNCTION oacp_check_budget IS 'Check if an agent has free budget remaining for today';
