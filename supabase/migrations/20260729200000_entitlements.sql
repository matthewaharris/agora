-- RFC 001 Phase 3 (final piece): entitlements — DORMANT wiring
--
-- §6 maps visibility tiers to hosted-registry plans, enforced at thread
-- creation / visibility upgrade. Enforcement ships OFF (edge function checks
-- the OACP_ENTITLEMENTS_ENFORCED env flag, same pattern as legal go-live):
-- during beta everyone keeps everything, and flipping the flag must never
-- break the RFC 004/005 safety story — friend-channel privacy (private +
-- sealed defaults) stays FREE. Only explicitly-requested advanced tiers are
-- gated, starting with 'secret'. "Advanced privacy features on the hosted
-- registry", never "pay or be watched".

CREATE TABLE IF NOT EXISTS entitlements (
  entitlement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Grants attach to an owner (account-level, covers all their agents) or a
  -- single agent (for unattached agents / targeted grants).
  subject_type TEXT NOT NULL CHECK (subject_type IN ('owner', 'agent')),
  subject_id UUID NOT NULL,
  -- Feature-grained, not plan-grained: 'visibility.secret' today; future
  -- candidates gate through the same rows ('mailbox.blinded' needs an
  -- anonymous-token design first — see RFC 001 §6 note).
  feature TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT,
  expires_at TIMESTAMPTZ,
  note TEXT,
  UNIQUE (subject_type, subject_id, feature)
);

COMMENT ON TABLE entitlements IS
  'RFC 001 §6: hosted-registry feature grants. Manual during beta; billing integration later. Enforcement is behind OACP_ENTITLEMENTS_ENFORCED (default off).';

CREATE INDEX IF NOT EXISTS idx_entitlements_subject
  ON entitlements (subject_type, subject_id, feature);

-- Service-role only, like every other base table since the RLS pass.
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;

-- Manual beta grants without hand-writing inserts:
--   SELECT oacp_grant_entitlement('owner', '<owner_id>', 'visibility.secret', 'beta grant');
CREATE OR REPLACE FUNCTION oacp_grant_entitlement(
  p_subject_type TEXT,
  p_subject_id UUID,
  p_feature TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO entitlements (subject_type, subject_id, feature, granted_by, note)
  VALUES (p_subject_type, p_subject_id, p_feature, 'manual', p_note)
  ON CONFLICT (subject_type, subject_id, feature) DO UPDATE SET note = COALESCE(p_note, entitlements.note)
  RETURNING entitlement_id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
