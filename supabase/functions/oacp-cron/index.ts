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

    return jsonResponse({
      status: 'ok',
      agents_marked_offline: affected,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[OACP-CRON] Unhandled error:', err);
    return errorResponse(message, 500);
  }
});
