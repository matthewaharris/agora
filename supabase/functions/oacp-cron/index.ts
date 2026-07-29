/**
 * OACP Cron — Auto-Offline Detection
 *
 * Calls the oacp_mark_offline_agents() Postgres function to mark
 * stale agents as offline. Deploy as a Supabase scheduled function
 * or call via external cron (e.g., Render cron job, GitHub Actions).
 *
 * Schedule: Every 30 seconds (or every minute on free tier).
 *
 * REQ-HB-02: Any agent without heartbeat in 90s → status = 'offline'
 */

import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts';
import { verifyDomainOwnerKey } from '../_shared/dns.ts';

/**
 * RFC 002 §4: re-check every verified domain handle.
 *
 * "DNS-verified org" is the strongest identity claim the registry makes, and
 * it was previously proved once and trusted forever — so an owner rotating
 * their account key, or the TXT record being edited away, left the badge
 * asserting something no longer true.
 *
 * Failures must be CONSECUTIVE (3) before the badge is withdrawn: DoH
 * resolvers fail transiently, and unverifying a legitimate org because of a
 * blip would be worse than a few hours of staleness. A resolver outage
 * (nothing resolved at all) is not counted as a failure.
 */
async function recheckDomainHandles(): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();
  const { data: owners, error } = await supabase
    .from('owners')
    .select('owner_id, handle, owner_public_key, domain_check_failures')
    .not('domain_verified_at', 'is', null);
  if (error) {
    console.error('[OACP-CRON] Domain owner query failed:', error);
    return { checked: 0, error: error.message };
  }

  let checked = 0;
  let stillValid = 0;
  let unverified = 0;
  const failing: string[] = [];

  for (const owner of owners ?? []) {
    const handle = owner.handle as string | null;
    if (!handle || !handle.includes('.')) continue; // not a domain handle
    checked++;

    const result = await verifyDomainOwnerKey(handle, owner.owner_public_key as string);

    if (result.ok) {
      stillValid++;
      if ((owner.domain_check_failures as number) > 0) {
        console.log(`[OACP-CRON] ${handle} recovered after ${owner.domain_check_failures} failure(s)`);
      }
      await supabase
        .from('owners')
        .update({ domain_check_failures: 0, domain_last_checked_at: new Date().toISOString() })
        .eq('owner_id', owner.owner_id);
      continue;
    }

    if (!result.resolved) {
      // Both resolvers were unreachable — our problem, not theirs.
      console.warn(`[OACP-CRON] DNS unreachable while checking ${handle}; not counting as a failure`);
      continue;
    }

    const failures = (owner.domain_check_failures as number) + 1;
    failing.push(`${handle} (${failures}/3)`);
    const withdraw = failures >= 3;
    await supabase
      .from('owners')
      .update({
        domain_check_failures: failures,
        domain_last_checked_at: new Date().toISOString(),
        ...(withdraw ? { domain_verified_at: null } : {}),
      })
      .eq('owner_id', owner.owner_id);

    if (withdraw) {
      unverified++;
      console.error(
        `[OACP-CRON] WITHDRAWN domain verification for ${handle} after 3 consecutive failures. ` +
        `Found TXT: ${JSON.stringify(result.found)}`,
      );
    } else {
      console.warn(
        `[OACP-CRON] Domain check failed for ${handle} (${failures}/3). Found TXT: ${JSON.stringify(result.found)}`,
      );
    }
  }

  return { checked, still_valid: stillValid, unverified, failing };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleCors();
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('oacp_mark_offline_agents');

    if (error) {
      console.error('[OACP-CRON] Error calling oacp_mark_offline_agents:', error);
      return errorResponse('Failed to run offline check', 500);
    }

    const affected = data ?? 0;
    if (affected > 0) {
      console.log(`[OACP-CRON] Marked ${affected} agent(s) offline`);
    }

    // RFC 001 §5: destroy payloads past their TTL or already read. Cheap
    // (two indexed UPDATEs), so it runs on every sweep rather than waiting
    // for a daily job — a burn-after-read payload lingering for hours would
    // defeat the point of asking for it.
    const { data: reaped } = await supabase.rpc('oacp_reap_expired_payloads');
    const reapResult = reaped as Record<string, number> | null;
    if (reapResult && (reapResult.expired > 0 || reapResult.burned > 0)) {
      console.log(
        `[OACP-CRON] Reaped payloads — expired: ${reapResult.expired}, burned: ${reapResult.burned}`,
      );
    }

    // RFC 001 §5.1: expired blinded-mailbox items are DELETED, not redacted —
    // those rows carry no envelope worth keeping, and the design goal is
    // that the data at rest tells no story.
    const { data: mailboxReaped } = await supabase.rpc('oacp_reap_mailbox');
    const mailboxDeleted = (mailboxReaped as number | null) ?? 0;
    if (mailboxDeleted > 0) {
      console.log(`[OACP-CRON] Deleted ${mailboxDeleted} expired mailbox item(s)`);
    }

    // Domain re-verification is far less urgent than offline detection, so
    // it only runs when explicitly asked (?domains=1) or on a daily cron —
    // the offline sweep runs every 30s and must stay cheap.
    const url = new URL(req.url);
    const domains = url.searchParams.get('domains') === '1'
      ? await recheckDomainHandles()
      : undefined;

    return jsonResponse({
      status: 'ok',
      agents_marked_offline: affected,
      ...(reapResult ? { reaped: reapResult } : {}),
      ...(mailboxDeleted > 0 ? { mailbox_deleted: mailboxDeleted } : {}),
      ...(domains ? { domain_recheck: domains } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[OACP-CRON] Unhandled error:', err);
    return errorResponse(message, 500);
  }
});
