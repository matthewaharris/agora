-- RFC 002 Phase 2 remainder: handle release + quarantine, friendship removal
--
-- Releasing an OWNER handle starts the §2.4 anti-phishing cooldown: the name
-- was a public identity, and letting someone else pick it up immediately is
-- how "@matt" becomes a phishing vector. Three deliberate exemptions:
--   * Agent handles quarantine nothing — they are scoped per owner
--     (@matt/desktop), and an owner re-assigning names inside their own
--     namespace can phish no one.
--   * Domain handles quarantine nothing — reclaiming one requires proving
--     DNS control, which IS the anti-phishing property.
--   * The releasing owner is exempt and may reclaim immediately — which also
--     makes a release by a compromised agent token self-healing.
--
-- Friendship removal needs no schema: the edge row simply goes away
-- (append-only was a beta simplification, not a design position).

CREATE TABLE IF NOT EXISTS handle_quarantine (
  handle TEXT PRIMARY KEY,
  released_by_owner UUID NOT NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '90 days'
);

COMMENT ON TABLE handle_quarantine IS
  'RFC 002 §2.4: released owner handles cool down for 90 days before anyone but the releasing owner may claim them.';

ALTER TABLE handle_quarantine ENABLE ROW LEVEL SECURITY;
-- Service-role only; the claim endpoint reports quarantine state itself.
