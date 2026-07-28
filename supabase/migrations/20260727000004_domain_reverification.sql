-- RFC 002 §4 follow-up: periodic domain re-verification
--
-- A domain handle was verified once, at claim time, and then trusted
-- forever. Two ways that silently goes wrong: the owner rotates their
-- account key (the DNS record now proves an old key), or the TXT record is
-- edited/removed (nothing proves anything). Either way the registry keeps
-- asserting "DNS-verified org" — the strongest identity claim it makes.
--
-- Re-checking needs state so a transient DNS blip doesn't unverify anyone:
-- failures must be consecutive before the badge is withdrawn.

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS domain_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS domain_check_failures INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN owners.domain_last_checked_at IS
  'RFC 002 §4: when the _oacp.<domain> TXT record was last re-checked.';
COMMENT ON COLUMN owners.domain_check_failures IS
  'Consecutive failed re-checks. Verification is withdrawn at 3 so a transient DNS failure cannot unverify a legitimate owner.';

-- Owners holding a domain handle (dotted) that is currently verified.
CREATE INDEX IF NOT EXISTS idx_owners_domain_verified
  ON owners (domain_last_checked_at)
  WHERE domain_verified_at IS NOT NULL;
