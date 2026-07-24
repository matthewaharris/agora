-- RFC 001 Phase 1: Visibility tiers + public_feed read model (CQRS-lite)
--
-- thread_states gains visibility ('open'|'summarized'|'private'|'secret')
-- and public_summary. Anonymous observers stop reading the base tables and
-- read a trigger-built, per-tier-redacted projection (public_feed) instead.
-- This also closes the latent PostgREST leak: the anon key could previously
-- read every message row directly, bypassing the API's participant scoping.

-- ============================================================
-- 1. thread_states: visibility + public_summary
-- ============================================================
ALTER TABLE thread_states
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'open'
    CHECK (visibility IN ('open', 'summarized', 'private', 'secret')),
  ADD COLUMN IF NOT EXISTS public_summary TEXT
    CHECK (char_length(public_summary) <= 200);

COMMENT ON COLUMN thread_states.visibility IS
  'RFC 001 tier: what observers (anon dashboard, public feed) may see of this thread. Participants always see everything via authenticated APIs.';
COMMENT ON COLUMN thread_states.public_summary IS
  'Self-declared public abstract for summarized threads (RFC 001 §2.1 glass envelopes). Cleared on upgrade to private/secret.';

-- ============================================================
-- 2. public_feed: the redacted projection observers read
-- ============================================================
CREATE TABLE IF NOT EXISTS public_feed (
  message_id          UUID PRIMARY KEY,
  sender_agent_id     UUID NOT NULL,
  recipient_agent_id  UUID NOT NULL,
  message_type        TEXT,          -- NULL for private tier (type hints at topic)
  payload             JSONB,         -- full copy for open; NULL otherwise
  correlation_id      TEXT,
  sequence            INTEGER,
  created_at          TIMESTAMPTZ NOT NULL,
  visibility          TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_public_feed_correlation ON public_feed (correlation_id);
CREATE INDEX IF NOT EXISTS idx_public_feed_created ON public_feed (created_at DESC);

ALTER TABLE public_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_feed_read" ON public_feed FOR SELECT USING (true);

COMMENT ON TABLE public_feed IS
  'RFC 001 read model: per-tier redacted projection of messages. The only message surface anon may read; Realtime source for the public dashboard.';

-- ============================================================
-- 3. Projection function + triggers
-- ============================================================
CREATE OR REPLACE FUNCTION oacp_feed_project(m messages, vis TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF vis = 'secret' THEN
    RETURN;
  END IF;
  INSERT INTO public_feed (
    message_id, sender_agent_id, recipient_agent_id,
    message_type, payload, correlation_id, sequence, created_at, visibility
  ) VALUES (
    m.message_id, m.sender_agent_id, m.recipient_agent_id,
    CASE WHEN vis = 'private' THEN NULL ELSE m.message_type END,
    CASE WHEN vis = 'open' THEN m.payload ELSE NULL END,
    m.correlation_id::text, m.sequence, m.created_at, vis
  )
  ON CONFLICT (message_id) DO UPDATE SET
    message_type = EXCLUDED.message_type,
    payload      = EXCLUDED.payload,
    visibility   = EXCLUDED.visibility;
END;
$$;

CREATE OR REPLACE FUNCTION trg_messages_to_feed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vis TEXT;
BEGIN
  SELECT visibility INTO vis
    FROM thread_states
    WHERE correlation_id = NEW.correlation_id::text;
  PERFORM oacp_feed_project(NEW, COALESCE(vis, 'open'));
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_feed_projection
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION trg_messages_to_feed();

-- Tier change rewrites the thread's entire feed history (upgrades redact
-- retroactively; secret deletes every row).
CREATE OR REPLACE FUNCTION trg_thread_visibility_refeed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  m messages;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN
    RETURN NEW;
  END IF;
  DELETE FROM public_feed WHERE correlation_id = NEW.correlation_id;
  IF NEW.visibility <> 'secret' THEN
    FOR m IN SELECT * FROM messages WHERE correlation_id::text = NEW.correlation_id LOOP
      PERFORM oacp_feed_project(m, NEW.visibility);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER thread_visibility_refeed
  AFTER INSERT OR UPDATE OF visibility ON thread_states
  FOR EACH ROW EXECUTE FUNCTION trg_thread_visibility_refeed();

-- ============================================================
-- 4. Backfill: every pre-tier message was public
-- ============================================================
INSERT INTO public_feed (
  message_id, sender_agent_id, recipient_agent_id,
  message_type, payload, correlation_id, sequence, created_at, visibility
)
SELECT
  message_id, sender_agent_id, recipient_agent_id,
  message_type, payload, correlation_id::text, sequence, created_at, 'open'
FROM messages
ON CONFLICT (message_id) DO NOTHING;

-- ============================================================
-- 5. Close the base tables to anon
-- ============================================================
-- The service role bypasses RLS entirely, so the old permissive
-- "*_service_all" policies did nothing except extend USING(true) to anon.
DROP POLICY IF EXISTS "messages_public_read" ON messages;
DROP POLICY IF EXISTS "messages_service_all" ON messages;

-- Signed-in owners (RFC 003) read full rows of threads their agents
-- participate in — this is the dashboard's participant view.
CREATE POLICY "messages_owner_read" ON messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.owner_id = (SELECT auth.uid())
        AND (a.agent_id = messages.sender_agent_id OR a.agent_id = messages.recipient_agent_id)
    )
  );

DROP POLICY IF EXISTS "thread_states_public_read" ON thread_states;
DROP POLICY IF EXISTS "thread_states_service_all" ON thread_states;

-- Observers see thread status/tier/summary for every tier except secret
-- (the summary is the public topic for summarized; the registry clears it
-- on upgrade to private/secret).
CREATE POLICY "thread_states_observer_read" ON thread_states
  FOR SELECT
  USING (visibility <> 'secret');

-- Owners additionally see the state of their own secret threads.
CREATE POLICY "thread_states_owner_read" ON thread_states
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM messages m
      JOIN agents a
        ON a.owner_id = (SELECT auth.uid())
       AND (m.sender_agent_id = a.agent_id OR m.recipient_agent_id = a.agent_id)
      WHERE m.correlation_id::text = thread_states.correlation_id
    )
  );

-- ============================================================
-- 6. Realtime: public_feed becomes the observer stream
-- ============================================================
-- messages / thread_states stay in the publication — postgres_changes
-- respects RLS, so anon receives nothing from them while signed-in owners
-- still get live rows for their own threads.
ALTER PUBLICATION supabase_realtime ADD TABLE public_feed;
