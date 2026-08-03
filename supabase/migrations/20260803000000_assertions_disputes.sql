-- RFC 007 §§2-4: assertions, disputes, and accuracy/calibration reputation
--
-- Decisions (2026-08-03, design review with the owner):
--   1. Hybrid ingestion — structured `assertions` blocks are the only thing
--      that moves reputation; prose extraction (future, hosted scoring layer)
--      may inform but never penalize. No unfair dings from a paraphrase.
--   2. Opaque in protocol, scored above — OACP relays the assertions block
--      like any payload content. The registry does not validate or reject
--      it; it COUNTS well-formed entries it can see (unsealed) for the
--      scoring layer. Scoring is the hosted product, not protocol law.
--   3. Digests only — the registry is a notary, not a vault. It timestamps
--      evidence commitments (sha256 digests); parties hold the artifacts.
--      An evidence warehouse would contradict RFC 001's whole retention
--      posture and make the registry a subpoena magnet.

-- Assertion aggregates live on the existing reputation row, counted at
-- message ingest for payloads the registry can read. Sealed payloads carry
-- their assertions inside the ciphertext — invisible here by design; those
-- claims are disputable via claim_digest but never counted.
ALTER TABLE reputation
  ADD COLUMN IF NOT EXISTS assertions_total INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assertions_measured INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assertions_assumed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assertions_reported INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS assertion_disputes (
  dispute_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  claim_index INT NOT NULL CHECK (claim_index >= 0 AND claim_index < 64),
  -- sha256 of the disputed claim text. Works identically for sealed and
  -- unsealed threads: the registry never needs to read the claim to anchor
  -- a dispute to it, and a sealed claim is never leaked by disputing it.
  claim_digest TEXT NOT NULL CHECK (claim_digest ~ '^sha256:[0-9a-f]{64}$'),
  disputed_agent_id UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  disputer_agent_id UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('refuted', 'unsupported')),
  -- The disputer's own assertion about the dispute — status, method,
  -- evidence digest. "You cannot refute a measurement with a vibe" is
  -- enforced at the endpoint: verdict 'refuted' requires a 'measured'
  -- counter-assertion with a method.
  assertion JSONB NOT NULL,
  -- The disputed agent's counter-evidence (one round in v1).
  response JSONB,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, claim_index, disputer_agent_id)
);

COMMENT ON TABLE assertion_disputes IS
  'RFC 007 §3: accuracy disputes against specific claims. Unlike RFC 005 flags (hostility), these are about whether a statement was true — and the disputer must stake its own method.';

CREATE INDEX IF NOT EXISTS idx_assertion_disputes_disputed
  ON assertion_disputes (disputed_agent_id, verdict);
CREATE INDEX IF NOT EXISTS idx_assertion_disputes_message
  ON assertion_disputes (message_id);

ALTER TABLE assertion_disputes ENABLE ROW LEVEL SECURITY;
-- Service-role only; participants read through the Edge Function, and the
-- public sees aggregates via /reputation.
