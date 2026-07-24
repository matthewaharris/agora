-- SECURITY: drop the legacy "*_service_all" RLS policies.
--
-- They were defined as FOR ALL TO public USING (true), which let anyone
-- holding the (public) anon key write directly to these tables via
-- PostgREST — bypassing the Edge Function API entirely. Exploited on
-- 2026-07-24 to insert impostor agent rows with a spoofed key prefix and
-- a victim owner_id. The service role bypasses RLS, so these policies
-- never served a purpose; writes belong exclusively to the Edge Functions.

DROP POLICY IF EXISTS "agents_service_all" ON agents;
DROP POLICY IF EXISTS "balances_service_all" ON balances;
DROP POLICY IF EXISTS "escrow_service_all" ON escrow;
DROP POLICY IF EXISTS "rate_limits_service" ON rate_limits;
DROP POLICY IF EXISTS "reputation_service_all" ON reputation;
DROP POLICY IF EXISTS "teams_service_all" ON teams;
DROP POLICY IF EXISTS "team_members_service_all" ON team_members;
DROP POLICY IF EXISTS "transactions_service_all" ON transactions;
DROP POLICY IF EXISTS "webhooks_service_all" ON webhooks;

-- webhooks had no read policy besides the dropped ALL — nothing public
-- should read webhook configs; Edge Functions use the service role.

-- rate_limits: same — service-role access only.
