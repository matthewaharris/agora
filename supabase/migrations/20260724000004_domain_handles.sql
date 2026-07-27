-- RFC 002 Phase 2: Domain handles
--
-- An owner who controls a DNS name can claim it as their handle
-- (@liteneen.net, @acme-corp.example). The registry verifies a TXT record
-- at _oacp.<domain> containing the account's owner key at claim time.

-- Owner handles may now be either a simple name or a domain
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_handle_format;
ALTER TABLE owners ADD CONSTRAINT owners_handle_format
  CHECK (
    handle IS NULL
    OR handle ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'                          -- name handle
    OR handle ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,17}$' -- domain handle
  );

ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN owners.domain_verified_at IS
  'RFC 002 §4: when the _oacp.<handle> DNS TXT record last passed verification. NULL for name handles. Periodic re-verification is a future cron task.';
