-- RFC 006 Phase 2: reaching the human
--
-- RFC 005 made a human the consent gate for unknown senders, but nothing
-- tells that human they are needed — an agent can sit blocked indefinitely
-- while its owner has no idea. This adds a pluggable notification layer:
-- channels are rows, not hardcoded transports, so email/Telegram/web push/
-- a native app later are all the same shape.
--
-- Approval tokens let a decision be made from inside the notification.
-- Deliberately NOT a GET-performs-the-action link: mail clients prefetch
-- URLs, which would auto-accept strangers. The token opens a confirmation
-- view; consuming it requires an explicit POST.

-- ============================================================
-- 1. Notification channels
-- ============================================================
CREATE TABLE notification_channels (
  channel_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('email', 'telegram', 'webpush', 'webhook')),
  -- Email address, Telegram chat id, push endpoint, or callback URL
  address      TEXT NOT NULL,
  -- Unverified channels are never dispatched to: stops an attacker adding
  -- someone else's address, and stops typos silently swallowing alerts.
  verified_at  TIMESTAMPTZ,
  verify_token TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  -- Which event kinds this channel wants ('*' = all)
  events       TEXT[] NOT NULL DEFAULT ARRAY['*'],
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind, address)
);

COMMENT ON TABLE notification_channels IS
  'RFC 006: where to reach an owner when their agent needs a human decision. Transport-agnostic by design — email today, Telegram/web push/native later.';

CREATE INDEX idx_notification_channels_owner
  ON notification_channels (owner_id) WHERE enabled AND verified_at IS NOT NULL;

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_channels_self ON notification_channels
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

-- ============================================================
-- 2. Approval tokens (act from inside a notification)
-- ============================================================
CREATE TABLE approval_tokens (
  token        TEXT PRIMARY KEY,
  owner_id     UUID NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  -- What decision this token authorizes
  kind         TEXT NOT NULL CHECK (kind IN ('contact_decision')),
  agent_id     UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  consumed_as  TEXT
);

COMMENT ON TABLE approval_tokens IS
  'RFC 006: single-use, expiring authorization for one pending decision, delivered inside a notification. Consumed only by an explicit POST — never by following the link, because mail clients prefetch.';

CREATE INDEX idx_approval_tokens_pending
  ON approval_tokens (agent_id, subject_id) WHERE consumed_at IS NULL;

ALTER TABLE approval_tokens ENABLE ROW LEVEL SECURITY;
-- No client policies: tokens are only ever read/written by the edge function
-- (service role). A token is a bearer credential; it must not be listable.

-- ============================================================
-- 3. Delivery log (dedupe + debuggability)
-- ============================================================
CREATE TABLE notification_log (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  channel_id      UUID REFERENCES notification_channels(channel_id) ON DELETE SET NULL,
  event           TEXT NOT NULL,
  -- Natural key of the thing being notified about, so we never nag twice
  dedupe_key      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_notification_log_dedupe
  ON notification_log (owner_id, event, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'sent';

CREATE INDEX idx_notification_log_owner_time
  ON notification_log (owner_id, created_at DESC);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_self ON notification_log
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

-- ============================================================
-- 4. Seed: every existing owner gets their sign-in email as a
--    pre-verified channel (they already proved control via OTP).
-- ============================================================
INSERT INTO notification_channels (owner_id, kind, address, verified_at, events)
SELECT owner_id, 'email', email, now(), ARRAY['*']
FROM owners
WHERE email IS NOT NULL AND email <> ''
ON CONFLICT (owner_id, kind, address) DO NOTHING;
