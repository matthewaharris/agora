/**
 * OACP Edge Function — Main Router
 *
 * Single "fat function" handling all OACP API routes:
 *   GET  /oacp/health         — Health check
 *   POST /oacp/register       — Agent registration
 *   POST /oacp/heartbeat      — Agent heartbeat
 *   GET  /oacp/discover       — Agent discovery
 *   POST /oacp/messages/send  — Send message
 *   GET  /oacp/messages       — Get messages for an agent
 *
 * Uses path-based routing to minimize cold starts.
 */

import { handleCors, jsonResponse, errorResponse, corsHeaders } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { verifyDomainOwnerKey } from '../_shared/dns.ts';
import {
  canonicalizeMessage,
  verifyMessageSignature,
} from '../_shared/crypto.ts';
import {
  validateRequired,
  validateCapabilities,
  validatePublicKey,
  validateUUID,
  validateSimpleSchema,
  type SimpleSchema,
  type ValidationError,
} from '../_shared/validation.ts';
import type {
  RegisterRequest,
  HeartbeatRequest,
  AgentStatus,
} from '../_shared/types.ts';

const OACP_VERSION = '0.1.0';

// Legal go-live switch. When true, /register returns a terms notice that the
// SDK/MCP surface to the operator (records that notice was presented on
// anonymous onboarding). Flip to true once the Terms/Privacy text is final.
const LEGAL_LIVE = false;
const TERMS_URL = 'https://www.liteneen.net/terms';
const PRIVACY_URL = 'https://www.liteneen.net/privacy';
const TERMS_NOTICE =
  'By registering and operating this agent on Liteneen you accept the Terms of Service ' +
  `(${TERMS_URL}) and Privacy Policy (${PRIVACY_URL}). Note: conversations are PUBLIC BY DEFAULT — ` +
  'use private/secret visibility and sealed payloads for anything sensitive.';
const legalFields = () =>
  LEGAL_LIVE ? { terms_url: TERMS_URL, privacy_url: PRIVACY_URL, terms_notice: TERMS_NOTICE } : {};
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ============================================================
// Helpers
// ============================================================

/**
 * Rate limit configuration per endpoint.
 */
const RATE_LIMITS: Record<string, { window: number; max: number }> = {
  '/register': { window: 60, max: 10 },
  '/heartbeat': { window: 60, max: 5 },
  '/messages/send': { window: 60, max: 30 },
  '/threads/update': { window: 60, max: 30 },
  '/handles/claim': { window: 60, max: 10 },
  '/friends/code': { window: 60, max: 10 },
  '/friends/redeem': { window: 60, max: 10 },
  '/friends/policy': { window: 60, max: 20 },
  '/resolve': { window: 60, max: 60 },
  '/discover': { window: 60, max: 60 },
  '/collect-payment': { window: 60, max: 30 },
  '/credit-work': { window: 60, max: 30 },
  '/transfer': { window: 60, max: 20 },
  // State-changing endpoints — throttle brute force / abuse
  '/owners/attach': { window: 60, max: 10 },
  '/agents/set-access': { window: 60, max: 20 },
  '/teams/create': { window: 60, max: 10 },
  '/teams/add-member': { window: 60, max: 20 },
  '/webhooks/register': { window: 60, max: 10 },
  '/escrow/hold': { window: 60, max: 30 },
  '/escrow/release': { window: 60, max: 30 },
  '/escrow/refund': { window: 60, max: 30 },
};

/**
 * Check rate limit for a request. Returns null if allowed, or a Response if rate limited.
 */
async function checkRateLimit(
  identifier: string,
  endpoint: string,
): Promise<Response | null> {
  const limits = RATE_LIMITS[endpoint];
  if (!limits) return null; // No rate limit configured

  try {
    const supabase = getSupabaseAdmin();
    const { data: allowed, error } = await supabase.rpc('oacp_check_rate_limit', {
      p_identifier: identifier,
      p_endpoint: endpoint,
      p_window_seconds: limits.window,
      p_max_requests: limits.max,
    });

    if (error) {
      console.error('[OACP] Rate limit check error:', error);
      return null; // Fail open — don't block on rate limit errors
    }

    if (!allowed) {
      return new Response(JSON.stringify({
        error: 'Too many requests',
        retry_after: limits.window,
        limit: limits.max,
        window_seconds: limits.window,
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(limits.window),
        },
      });
    }
  } catch {
    // Fail open
  }

  return null;
}

/**
 * Get a rate limit identifier from the request (IP or agent_id).
 */
function getRateLimitId(req: Request, body?: Record<string, unknown>): string {
  // Try agent_id from body first
  if (body && typeof body.agent_id === 'string') return `agent:${body.agent_id}`;
  if (body && typeof body.sender_agent_id === 'string') return `agent:${body.sender_agent_id}`;
  // Fall back to IP
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  return `ip:${ip}`;
}

function extractRoute(url: string): string {
  const u = new URL(url);
  const pathname = u.pathname;
  const match = pathname.match(/\/oacp(?:\/(.*))?$/);
  if (match) {
    return '/' + (match[1] || '');
  }
  return pathname;
}

type RouteHandler = (req: Request) => Promise<Response> | Response;

/**
 * Generate a registry token (random UUID-based bearer token).
 */
function generateRegistryToken(): string {
  return crypto.randomUUID() + '-' + crypto.randomUUID();
}

/**
 * Hash a registry token using SHA-256 for storage.
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * RFC 006: the per-agent push notification channel.
 *
 * Derived from the agent's id AND its hashed registry token, so only the
 * agent (which holds the raw token) and the registry can compute it — an
 * agent_id alone is public via /discover and must not be enough to listen
 * in. Broadcast carries envelope metadata only; the REST inbox stays
 * authoritative for content.
 */
async function notifyChannelName(agentId: string, tokenHash: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`oacp-notify:${agentId}:${tokenHash}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `oacp-notify-${hex}`;
}

/**
 * Push a delivery notification to the recipient's channel via Realtime's
 * HTTP broadcast API (no websocket setup cost inside the request path).
 * Best-effort: push only shortcuts the wait, so a failure here degrades to
 * the SDK's polling fallback rather than failing the send.
 */
async function pushNotify(
  recipientAgentId: string,
  recipientTokenHash: string,
  envelope: Record<string, unknown>,
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;
    const topic = await notifyChannelName(recipientAgentId, recipientTokenHash);
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event: 'message', payload: envelope }],
      }),
    });
    if (!res.ok) {
      console.warn(`[OACP] Push notify failed (${res.status}) for ${recipientAgentId}`);
    }
  } catch (err) {
    console.warn('[OACP] Push notify error:', err instanceof Error ? err.message : err);
  }
}

// ============================================================
// RFC 006 Phase 2: notifications — reaching the human
// ============================================================

const DASHBOARD_URL = 'https://dashboard.liteneen.net';
const NOTIFY_FROM = 'Liteneen <signin@liteneen.net>';

/** Cryptographically random URL-safe token. */
function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deliver one notification to every verified, enabled channel an owner has.
 * Best-effort and deduplicated: a repeat event with the same dedupe_key is
 * skipped, so a chatty sender can't turn into an inbox flood.
 *
 * Transport-agnostic on purpose — adding Telegram or web push means adding a
 * case here, not touching any caller.
 */
async function notifyOwner(
  ownerId: string,
  event: string,
  content: { subject: string; text: string; html?: string },
  dedupeKey?: string,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    if (dedupeKey) {
      const { data: prior } = await supabase
        .from('notification_log')
        .select('notification_id')
        .eq('owner_id', ownerId)
        .eq('event', event)
        .eq('dedupe_key', dedupeKey)
        .eq('status', 'sent')
        .limit(1);
      if (prior && prior.length > 0) return;
    }

    const { data: channels } = await supabase
      .from('notification_channels')
      .select('channel_id, kind, address, events')
      .eq('owner_id', ownerId)
      .eq('enabled', true)
      .not('verified_at', 'is', null);

    for (const ch of channels ?? []) {
      const wants = (ch.events as string[]) ?? ['*'];
      if (!wants.includes('*') && !wants.includes(event)) continue;

      let status = 'skipped';
      let detail: string | null = null;
      try {
        if (ch.kind === 'email') {
          const result = await sendEmail(ch.address as string, content);
          status = result.ok ? 'sent' : 'failed';
          detail = result.detail;
        } else if (ch.kind === 'telegram') {
          const result = await sendTelegram(ch.address as string, content);
          status = result.ok ? 'sent' : 'failed';
          detail = result.detail;
        } else {
          detail = `No transport implemented for kind '${ch.kind}'`;
        }
      } catch (err) {
        status = 'failed';
        detail = err instanceof Error ? err.message : String(err);
      }

      await supabase.from('notification_log').insert({
        owner_id: ownerId,
        channel_id: ch.channel_id,
        event,
        dedupe_key: dedupeKey ?? null,
        status,
        detail,
      });
    }
  } catch (err) {
    // Notification failure must never fail the operation that triggered it.
    console.warn('[OACP] notifyOwner error:', err instanceof Error ? err.message : err);
  }
}

async function sendEmail(
  to: string,
  content: { subject: string; text: string; html?: string },
): Promise<{ ok: boolean; detail: string | null }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, detail: 'RESEND_API_KEY not configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [to],
      subject: content.subject,
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
    }),
  });
  if (!res.ok) {
    return { ok: false, detail: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { ok: true, detail: null };
}

async function sendTelegram(
  chatId: string,
  content: { subject: string; text: string },
): Promise<{ ok: boolean; detail: string | null }> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, detail: 'TELEGRAM_BOT_TOKEN not configured' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `*${content.subject}*\n\n${content.text}`,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    return { ok: false, detail: `Telegram ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { ok: true, detail: null };
}

/**
 * Tell an owner that a stranger's first contact is being held for them.
 * Carries a single-use approval token so the decision can be made from the
 * notification instead of hunting for the message in the dashboard.
 */
async function notifyQuarantine(
  recipient: { agent_id: string; name: string; owner_id: string | null },
  sender: { agent_id: string; name: string },
  messageId: string,
): Promise<void> {
  if (!recipient.owner_id) return;
  const supabase = getSupabaseAdmin();

  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase.from('approval_tokens').insert({
    token,
    owner_id: recipient.owner_id,
    kind: 'contact_decision',
    agent_id: recipient.agent_id,
    subject_id: sender.agent_id,
    expires_at: expires,
  });
  if (error) {
    console.warn('[OACP] approval token insert failed:', error.message);
    return;
  }

  const link = `${DASHBOARD_URL}/?approve=${token}`;
  const subject = `${sender.name} wants to reach ${recipient.name}`;
  const text =
    `An agent you don't know — ${sender.name} — sent a first message to your agent ${recipient.name}.\n\n` +
    `Liteneen is holding it: the contents have NOT been shown to your agent, and won't be until you decide.\n\n` +
    `Review and decide:\n${link}\n\n` +
    `Accepting releases every message held from this sender and lets future ones through. ` +
    `Blocking makes their messages bounce.\n\n` +
    `This link expires in 7 days. If you ignore it, the message simply stays held.`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;line-height:1.5">` +
    `<h2 style="font-size:18px;margin:0 0 12px">${escapeHtmlText(sender.name)} wants to reach ${escapeHtmlText(recipient.name)}</h2>` +
    `<p style="color:#444">An agent you don't know sent a first message to your agent. Liteneen is holding it — the contents have <strong>not</strong> been shown to your agent, and won't be until you decide.</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Review and decide</a></p>` +
    `<p style="color:#666;font-size:13px">Accepting releases every message held from this sender and lets future ones through. Blocking makes their messages bounce. This link expires in 7 days; ignoring it leaves the message held.</p>` +
    `</div>`;

  await notifyOwner(
    recipient.owner_id,
    'quarantine_pending',
    { subject, text, html },
    // One nag per (recipient, sender) pair — not per message.
    `contact:${recipient.agent_id}:${sender.agent_id}`,
  );
  console.log(`[OACP] Quarantine notification queued for owner ${recipient.owner_id} (msg ${messageId})`);
}

function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Validate a webhook callback URL against SSRF. Returns an error string, or
 * null if acceptable. Requires https and rejects hosts that are literally
 * loopback/link-local/private/internal by name. (Full protection also needs
 * resolve-time IP checks at delivery; this is the registration-time gate.)
 */
function validateCallbackUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'callback_url must be a valid absolute URL';
  }
  if (u.protocol !== 'https:') return 'callback_url must use https';
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fe80:/i.test(host) ||
    /^fc00:/i.test(host) ||
    /^fd[0-9a-f]{2}:/i.test(host)
  ) {
    return 'callback_url may not point to a private, loopback, or link-local address';
  }
  return null;
}

/**
 * Return validation errors as a 400 response.
 */
function validationErrorResponse(errors: ValidationError[]): Response {
  return errorResponse('Validation failed', 400, {
    validation_errors: errors,
  });
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET /health — Health check
 */
function handleHealth(): Response {
  return jsonResponse({
    status: 'ok',
    version: OACP_VERSION,
    protocol: 'oacp',
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /register — Agent registration
 *
 * REQ-REG-01: Accepts Agent Card payload
 * REQ-REG-02: Returns agent_id + registry_token
 * REQ-REG-03: Persists with timestamps
 * REQ-REG-04: Re-registration with existing agent_id updates fields
 */
async function handleRegister(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Check for re-registration (agent_id provided)
  const isReregistration = typeof body.agent_id === 'string' && body.agent_id !== '';

  // Validate required fields
  const requiredErrors = validateRequired(body, ['name', 'public_key', 'capabilities']);
  if (requiredErrors.length > 0) {
    return validationErrorResponse(requiredErrors);
  }

  // Validate capabilities
  const capErrors = validateCapabilities(body.capabilities);
  if (capErrors.length > 0) {
    return validationErrorResponse(capErrors);
  }

  // Validate public key format
  const pkErrors = validatePublicKey(body.public_key);
  if (pkErrors.length > 0) {
    return validationErrorResponse(pkErrors);
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (isReregistration) {
    // REQ-REG-04: Re-registration — verify token matches
    const token = extractBearerToken(req);
    if (!token) {
      return errorResponse('Authorization header with Bearer token required for re-registration', 401);
    }

    const agentIdErrors = validateUUID(body.agent_id);
    if (agentIdErrors.length > 0) {
      return validationErrorResponse(agentIdErrors);
    }

    const tokenHash = await hashToken(token);

    // Verify agent exists and token matches
    const { data: existing, error: fetchError } = await supabase
      .from('agents')
      .select('agent_id, registry_token')
      .eq('agent_id', body.agent_id)
      .single();

    if (fetchError || !existing) {
      return errorResponse('Agent not found', 404);
    }

    if (existing.registry_token !== tokenHash) {
      return errorResponse('Invalid registry token', 403);
    }

    // Update the agent card
    const updateFields: Record<string, unknown> = {
      name: body.name,
      capabilities: body.capabilities,
      public_key: body.public_key,
      status: 'online',
      last_seen_at: now,
    };
    if (body.owner_handle !== undefined) updateFields.owner_handle = body.owner_handle;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.endpoint_url !== undefined) updateFields.endpoint_url = body.endpoint_url;
    if (body.protocols_supported !== undefined) updateFields.protocols_supported = body.protocols_supported;
    if (body.metadata !== undefined) updateFields.metadata = body.metadata;

    const { error: updateError } = await supabase
      .from('agents')
      .update(updateFields)
      .eq('agent_id', body.agent_id);

    if (updateError) {
      console.error('[OACP] Re-registration update error:', updateError);
      return errorResponse('Failed to update agent', 500);
    }

    return jsonResponse({
      agent_id: body.agent_id,
      updated: true,
      last_seen_at: now,
    });
  }

  // Check if this public_key already exists (persistent identity)
  const { data: existingAgent, error: lookupError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('public_key', body.public_key)
    .maybeSingle();

  if (existingAgent) {
    // Returning agent — update their info and issue a new token
    const registryToken = generateRegistryToken();
    const tokenHash = await hashToken(registryToken);

    const updateFields: Record<string, unknown> = {
      name: body.name,
      capabilities: body.capabilities,
      status: 'online',
      last_seen_at: now,
      registry_token: tokenHash,
    };
    if (body.owner_handle !== undefined) updateFields.owner_handle = body.owner_handle;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.endpoint_url !== undefined) updateFields.endpoint_url = body.endpoint_url;
    if (body.protocols_supported !== undefined) updateFields.protocols_supported = body.protocols_supported;
    if (body.metadata !== undefined) updateFields.metadata = body.metadata;

    const { error: updateError } = await supabase
      .from('agents')
      .update(updateFields)
      .eq('agent_id', existingAgent.agent_id);

    if (updateError) {
      console.error('[OACP] Returning agent update error:', updateError);
      return errorResponse('Failed to update agent', 500);
    }

    console.log(`[OACP] Agent returned: ${existingAgent.agent_id} (${body.name})`);

    return jsonResponse(
      {
        agent_id: existingAgent.agent_id,
        registry_token: registryToken,
        returning: true,
        ...legalFields(),
      },
      200,
    );
  }

  // New registration
  const registryToken = generateRegistryToken();
  const tokenHash = await hashToken(registryToken);

  const insertData = {
    name: body.name as string,
    owner_handle: (body.owner_handle as string) || null,
    description: (body.description as string) || '',
    endpoint_url: (body.endpoint_url as string) || null,
    capabilities: body.capabilities as string[],
    public_key: body.public_key as string,
    protocols_supported: (body.protocols_supported as string[]) || ['oacp/v1'],
    metadata: (body.metadata as Record<string, unknown>) || {},
    registry_token: tokenHash,
    status: 'online' as const,
    last_seen_at: now,
  };

  const { data, error } = await supabase
    .from('agents')
    .insert(insertData)
    .select('agent_id, created_at')
    .single();

  if (error) {
    console.error('[OACP] Registration insert error:', error);
    return errorResponse('Failed to register agent', 500);
  }

  console.log(`[OACP] Agent registered: ${data.agent_id} (${body.name})`);

  return jsonResponse(
    {
      agent_id: data.agent_id,
      registry_token: registryToken, // Return raw token (only time it's visible)
      created_at: data.created_at,
      ...legalFields(),
    },
    201,
  );
}

/**
 * POST /heartbeat — Agent heartbeat
 *
 * REQ-HB-01: Updates last_seen_at at configurable interval
 * REQ-HB-02: Auto-offline after 90s (handled by scheduled function)
 * REQ-HB-03: Status changes emit Realtime events
 */
async function handleHeartbeat(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate agent_id
  const idErrors = validateUUID(body.agent_id, 'agent_id');
  if (idErrors.length > 0) {
    return validationErrorResponse(idErrors);
  }

  // Verify bearer token
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Verify agent exists and token matches
  const { data: existing, error: fetchError } = await supabase
    .from('agents')
    .select('agent_id, registry_token, status')
    .eq('agent_id', body.agent_id)
    .single();

  if (fetchError || !existing) {
    return errorResponse('Agent not found', 404);
  }

  if (existing.registry_token !== tokenHash) {
    return errorResponse('Invalid registry token', 403);
  }

  // Determine new status (preserve 'busy' if set, otherwise 'online')
  const newStatus = existing.status === 'busy' ? 'busy' : 'online';
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('agents')
    .update({
      last_seen_at: now,
      status: newStatus,
    })
    .eq('agent_id', body.agent_id);

  if (updateError) {
    console.error('[OACP] Heartbeat update error:', updateError);
    return errorResponse('Failed to update heartbeat', 500);
  }

  return jsonResponse({
    agent_id: body.agent_id,
    status: newStatus,
    last_seen_at: now,
  });
}

/**
 * GET /discover — Agent discovery
 *
 * REQ-DISC-01: Filter by capability, status, owner_handle
 * REQ-DISC-02: Returns Agent Cards without registry_token
 * REQ-DISC-03: Paginated with default page_size=20
 */
async function handleDiscover(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const capability = url.searchParams.get('capability');
  const status = url.searchParams.get('status') as AgentStatus | null;
  const ownerHandle = url.searchParams.get('owner_handle');
  const agentId = url.searchParams.get('agent_id');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE), 10)),
  );

  // Validate status if provided
  if (status && !['online', 'offline', 'busy'].includes(status)) {
    return errorResponse("status must be 'online', 'offline', or 'busy'", 400);
  }

  const supabase = getSupabaseAdmin();
  const offset = (page - 1) * pageSize;

  // Build query — select all fields except registry_token
  let query = supabase
    .from('agents')
    .select(
      'agent_id, name, owner_handle, handle, access_policy, description, endpoint_url, capabilities, status, public_key, protocols_supported, metadata, last_seen_at, created_at, updated_at, owners:owner_id(owner_public_key, handle)',
      { count: 'exact' },
    );

  // Apply filters
  if (agentId) {
    // Direct card lookup — used by senders to fetch a recipient's
    // public_key before sealing a payload (RFC 001 §4)
    query = query.eq('agent_id', agentId);
  }
  if (capability) {
    // Use Postgres array contains operator for GIN-indexed lookup
    query = query.contains('capabilities', [capability]);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (ownerHandle) {
    query = query.eq('owner_handle', ownerHandle);
  }

  // Apply pagination
  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[OACP] Discovery query error:', error);
    return errorResponse('Failed to query agents', 500);
  }

  // Flatten the owners join: account owner_public_key (RFC 003) rides on
  // the card so senders can seal to the owner without a second lookup.
  // RFC 002: the claimed, fully-qualified handle (@owner/agent) when both
  // parts exist — distinct from the legacy free-text owner_handle hint.
  const agents = (data || []).map((a: Record<string, unknown>) => {
    const owners = a.owners as { owner_public_key?: string; handle?: string } | null;
    const { owners: _drop, handle: agentHandle, ...card } = a;
    return {
      ...card,
      handle: owners?.handle && agentHandle ? `@${owners.handle}/${agentHandle}` : null,
      owner_verified_handle: owners?.handle ? `@${owners.handle}` : null,
      owner_public_key: owners?.owner_public_key ?? null,
    };
  });

  return jsonResponse({
    agents,
    total: count || 0,
    page,
    page_size: pageSize,
  });
}

/**
 * POST /owners/attach — Link an agent to an owner account (RFC 003 §2.2)
 *
 * Agent-authenticated (registry token). Consumes a single-use, short-lived
 * attach code minted by the signed-in owner in the dashboard.
 */
async function handleOwnersAttach(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const idErrors = validateUUID(body.agent_id, 'agent_id');
  if (idErrors.length > 0) {
    return validationErrorResponse(idErrors);
  }
  if (typeof body.code !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(body.code)) {
    return errorResponse('code must be a valid attach code', 400);
  }

  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', body.agent_id)
    .single();

  if (agentError || !agent) {
    return errorResponse('Agent not found', 404);
  }
  if (agent.registry_token !== tokenHash) {
    return errorResponse('Invalid registry token', 403);
  }

  const code = (body.code as string).toUpperCase();
  const { data: attachCode } = await supabase
    .from('attach_codes')
    .select('code, owner_id, expires_at, used_by_agent_id')
    .eq('code', code)
    .single();

  if (!attachCode) {
    return errorResponse('Unknown attach code', 404);
  }
  if (attachCode.used_by_agent_id) {
    return errorResponse('Attach code already used', 409);
  }
  if (new Date(attachCode.expires_at).getTime() < Date.now()) {
    return errorResponse('Attach code expired', 410);
  }

  const { error: linkError } = await supabase
    .from('agents')
    .update({ owner_id: attachCode.owner_id })
    .eq('agent_id', body.agent_id);

  if (linkError) {
    console.error('[OACP] Owner attach error:', linkError);
    return errorResponse('Failed to attach agent to owner', 500);
  }

  await supabase
    .from('attach_codes')
    .update({ used_by_agent_id: body.agent_id })
    .eq('code', code);

  const { data: owner } = await supabase
    .from('owners')
    .select('owner_id, owner_public_key')
    .eq('owner_id', attachCode.owner_id)
    .single();

  return jsonResponse({
    agent_id: body.agent_id,
    owner_id: attachCode.owner_id,
    owner_public_key: owner?.owner_public_key ?? null,
    note: 'Agent attached. Sealed messages now include the account owner as a reader.',
  });
}

// ============================================================
// RFC 002 — Handles, friendships, access policy
// ============================================================

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
// Domain handles (RFC 002 §4): @liteneen.net, @acme-corp.example
const DOMAIN_HANDLE_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,17}$/;
const RESERVED_HANDLES = new Set([
  'oacp', 'liteneen', 'agora', 'stait', 'admin', 'administrator', 'registry',
  'root', 'support', 'help', 'api', 'www', 'mail', 'owner', 'agent', 'agents',
  'system', 'moderator', 'staff', 'official', 'security', 'abuse', 'billing',
]);

/** Authenticate an agent by agent_id + Bearer registry token. */
async function requireAgentAuth(
  req: Request,
  agentId: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<{ agent: any } | { error: Response }> {
  const idErrors = validateUUID(agentId, 'agent_id');
  if (idErrors.length > 0) return { error: validationErrorResponse(idErrors) };

  const token = extractBearerToken(req);
  if (!token) {
    return { error: errorResponse('Authorization header with Bearer token required', 401) };
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  const { data: agent, error } = await supabase
    .from('agents')
    .select('agent_id, name, public_key, registry_token, owner_id, handle, access_policy')
    .eq('agent_id', agentId)
    .single();

  if (error || !agent) return { error: errorResponse('Agent not found', 404) };
  if (agent.registry_token !== tokenHash) return { error: errorResponse('Invalid registry token', 403) };
  return { agent };
}


/**
 * POST /handles/claim — claim an owner handle and/or this agent's handle.
 * Body: { agent_id, owner_handle?, agent_handle? }
 * Agent auth; the agent must be attached to an owner account (RFC 003).
 * A dotted owner_handle (e.g. "liteneen.net") is a domain handle: the claim
 * verifies control via the _oacp.<domain> DNS TXT record.
 */
async function handleHandlesClaim(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const auth = await requireAgentAuth(req, body.agent_id);
  if ('error' in auth) return auth.error;
  const agent = auth.agent;

  if (!agent.owner_id) {
    return errorResponse(
      'Handles require an owner account: attach this agent first (dashboard → "Attach an agent", then oacp_attach_owner)',
      403,
      { error_code: 'no_owner_account' },
    );
  }

  const ownerHandle = body.owner_handle as string | undefined;
  const agentHandle = body.agent_handle as string | undefined;
  if (ownerHandle === undefined && agentHandle === undefined) {
    return errorResponse('Provide owner_handle and/or agent_handle', 400);
  }

  const supabase = getSupabaseAdmin();
  const { data: owner } = await supabase
    .from('owners')
    .select('owner_id, handle, owner_public_key')
    .eq('owner_id', agent.owner_id)
    .single();
  if (!owner) return errorResponse('Owner account not found', 404);

  let finalOwnerHandle = owner.handle as string | null;

  if (ownerHandle !== undefined) {
    const h = String(ownerHandle).toLowerCase().replace(/^@/, '');
    const isDomain = DOMAIN_HANDLE_RE.test(h);
    if (!isDomain && (!HANDLE_RE.test(h) || h.length < 3)) {
      return errorResponse(
        'owner_handle must be 3-32 chars (lowercase letters, digits, inner hyphens) or a domain you control (e.g. "liteneen.net")',
        400,
      );
    }
    if (!isDomain && RESERVED_HANDLES.has(h)) {
      return errorResponse(`Handle "@${h}" is reserved`, 403, { error_code: 'handle_reserved' });
    }
    if (owner.handle && owner.handle !== h) {
      return errorResponse(
        `This account already claimed "@${owner.handle}" — release/transfer is not yet supported`,
        409,
        { error_code: 'handle_already_claimed', current: owner.handle },
      );
    }
    if (!owner.handle) {
      // Domain handles are claimed by proof of DNS control, not first-come
      if (isDomain) {
        const dns = await verifyDomainOwnerKey(h, owner.owner_public_key as string);
        if (!dns.ok) {
          return errorResponse(
            `Domain not verified: add a DNS TXT record at _oacp.${h} with the value "oacp-owner-key=${owner.owner_public_key}" and retry once it propagates.`,
            403,
            { error_code: 'domain_not_verified', expected: `oacp-owner-key=${owner.owner_public_key}`, found: dns.found },
          );
        }
      }
      const { error: claimError } = await supabase
        .from('owners')
        .update({
          handle: h,
          domain_verified_at: isDomain ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('owner_id', agent.owner_id);
      if (claimError) {
        // Unique violation → someone else holds it
        return errorResponse(`Handle "@${h}" is taken`, 409, { error_code: 'handle_taken' });
      }
    }
    finalOwnerHandle = h;
  }

  let finalAgentHandle = agent.handle as string | null;

  if (agentHandle !== undefined) {
    const h = String(agentHandle).toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(h)) {
      return errorResponse('agent_handle must be 1-32 chars: lowercase letters, digits, inner hyphens', 400);
    }
    const { error: setError } = await supabase
      .from('agents')
      .update({ handle: h })
      .eq('agent_id', agent.agent_id);
    if (setError) {
      return errorResponse(
        `Agent handle "${h}" is already used by another of this owner's agents`,
        409,
        { error_code: 'agent_handle_taken' },
      );
    }
    finalAgentHandle = h;
  }

  const full = finalOwnerHandle && finalAgentHandle ? `@${finalOwnerHandle}/${finalAgentHandle}` : null;
  console.log(`[OACP] Handle claim by ${agent.name}: ${full ?? `owner=@${finalOwnerHandle ?? '—'} agent=${finalAgentHandle ?? '—'}`}`);
  return jsonResponse({
    owner_handle: finalOwnerHandle ? `@${finalOwnerHandle}` : null,
    agent_handle: finalAgentHandle,
    handle: full,
  });
}

/**
 * GET /resolve?handle=@owner or @owner/agent — public handle resolution.
 */
async function handleResolve(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get('handle');
  if (!raw) return errorResponse('handle query parameter is required', 400);

  const parts = raw.toLowerCase().replace(/^@/, '').split('/');
  const ownerOk = HANDLE_RE.test(parts[0]) || DOMAIN_HANDLE_RE.test(parts[0]);
  if (parts.length > 2 || !ownerOk || (parts[1] !== undefined && !HANDLE_RE.test(parts[1]))) {
    return errorResponse('handle must look like @owner or @owner/agent (owner may be a domain, e.g. @liteneen.net/desktop)', 400);
  }
  const [ownerPart, agentPart] = parts;

  const supabase = getSupabaseAdmin();
  const { data: owner } = await supabase
    .from('owners')
    .select('owner_id, handle, owner_public_key, domain_verified_at')
    .eq('handle', ownerPart)
    .maybeSingle();
  if (!owner) return errorResponse(`Handle "@${ownerPart}" is not claimed`, 404);

  let query = supabase
    .from('agents')
    .select('agent_id, name, handle, access_policy, description, capabilities, status, public_key, metadata, last_seen_at')
    .eq('owner_id', owner.owner_id);
  if (agentPart) query = query.eq('handle', agentPart);

  const { data: agents } = await query;
  if (agentPart && (!agents || agents.length === 0)) {
    return errorResponse(`No agent "${agentPart}" under @${ownerPart}`, 404);
  }

  const cards = (agents || []).map((a) => ({
    ...a,
    handle: a.handle ? `@${owner.handle}/${a.handle}` : null,
    owner_verified_handle: `@${owner.handle}`,
    owner_public_key: owner.owner_public_key,
  }));

  const domainVerified = owner.domain_verified_at ? { domain_verified: true } : {};
  return jsonResponse(
    agentPart
      ? { handle: raw, ...domainVerified, agent: cards[0] }
      : { handle: `@${owner.handle}`, ...domainVerified, owner_public_key: owner.owner_public_key, agents: cards },
  );
}

const FRIEND_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * POST /friends/code — mint a single-use pairing code (RFC 002 §3.1).
 * Body: { agent_id }. Agent auth. 15-minute expiry.
 */
async function handleFriendCode(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const auth = await requireAgentAuth(req, body.agent_id);
  if ('error' in auth) return auth.error;

  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = Array.from(bytes).map((b) => FRIEND_CODE_CHARSET[b % FRIEND_CODE_CHARSET.length]);
  const code = `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('friend_codes').insert({
    code,
    issuer_agent_id: auth.agent.agent_id,
    expires_at: expiresAt,
  });
  if (error) {
    console.error('[OACP] Friend code insert error:', error);
    return errorResponse('Failed to create friend code', 500);
  }

  return jsonResponse({
    code,
    expires_at: expiresAt,
    note: 'Give this code to the other human out of band (text, call). Their agent redeems it with oacp_add_friend — that creates a mutual, key-pinned friendship. Single use.',
  });
}

/** Canonical pair ordering for the friendships table. */
function friendPair(a: string, b: string): { lo: string; hi: string } {
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}

/**
 * Return the friendship edge between two agents (with its RFC 004 privacy
 * policy) or null if they are not friends.
 */
async function getFriendship(
  agentA: string,
  agentB: string,
  // deno-lint-ignore no-explicit-any
): Promise<{ default_visibility: string; sealed_required: boolean } | null> {
  const { lo, hi } = friendPair(agentA, agentB);
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('friendships')
    .select('default_visibility, sealed_required')
    .eq('agent_lo', lo)
    .eq('agent_hi', hi)
    .maybeSingle();
  return data ?? null;
}

async function areFriends(agentA: string, agentB: string): Promise<boolean> {
  return (await getFriendship(agentA, agentB)) !== null;
}

/**
 * RFC 005: the recipient's standing decision about a non-friend sender.
 * Returns 'accepted' | 'blocked' | null (unknown sender).
 */
async function getContactStatus(
  recipientId: string,
  senderId: string,
): Promise<'accepted' | 'blocked' | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('contacts')
    .select('status')
    .eq('recipient_agent_id', recipientId)
    .eq('sender_agent_id', senderId)
    .maybeSingle();
  return (data?.status as 'accepted' | 'blocked' | undefined) ?? null;
}

/**
 * RFC 002 §2: a dotted owner segment means the handle was claimed by DNS
 * TXT proof — impersonation-proof org identity.
 */
function isDomainVerifiedHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  const owner = handle.replace(/^@/, '').split('/')[0];
  return owner.includes('.');
}

/**
 * POST /friends/redeem — redeem a pairing code, creating the friendship.
 * Body: { agent_id, code }. Agent auth.
 */
async function handleFriendRedeem(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const auth = await requireAgentAuth(req, body.agent_id);
  if ('error' in auth) return auth.error;
  const redeemer = auth.agent;

  if (typeof body.code !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(body.code)) {
    return errorResponse('code must be a valid friend code', 400);
  }
  const code = body.code.toUpperCase();

  const supabase = getSupabaseAdmin();
  const { data: fc } = await supabase
    .from('friend_codes')
    .select('code, issuer_agent_id, expires_at, redeemed_by_agent_id')
    .eq('code', code)
    .maybeSingle();

  if (!fc) return errorResponse('Unknown friend code', 404);
  if (fc.redeemed_by_agent_id) return errorResponse('Friend code already used', 409);
  if (new Date(fc.expires_at).getTime() < Date.now()) return errorResponse('Friend code expired', 410);
  if (fc.issuer_agent_id === redeemer.agent_id) {
    return errorResponse('Cannot redeem your own friend code — give it to the other human', 400);
  }

  const { data: issuer } = await supabase
    .from('agents')
    .select('agent_id, name, handle, access_policy, public_key, status, last_seen_at, owner_id, owners:owner_id(handle, owner_public_key)')
    .eq('agent_id', fc.issuer_agent_id)
    .single();
  if (!issuer) return errorResponse('Issuing agent no longer exists', 410);

  const { lo, hi } = friendPair(issuer.agent_id, redeemer.agent_id);
  const pinnedLo = lo === issuer.agent_id ? issuer.public_key : redeemer.public_key;
  const pinnedHi = hi === issuer.agent_id ? issuer.public_key : redeemer.public_key;

  const { error: fError } = await supabase.from('friendships').upsert(
    { agent_lo: lo, agent_hi: hi, pinned_key_lo: pinnedLo, pinned_key_hi: pinnedHi },
    { onConflict: 'agent_lo,agent_hi', ignoreDuplicates: true },
  );
  if (fError) {
    console.error('[OACP] Friendship insert error:', fError);
    return errorResponse('Failed to create friendship', 500);
  }

  await supabase
    .from('friend_codes')
    .update({ redeemed_by_agent_id: redeemer.agent_id, redeemed_at: new Date().toISOString() })
    .eq('code', code);

  // deno-lint-ignore no-explicit-any
  const issuerOwner = issuer.owners as any;
  console.log(`[OACP] Friendship: ${issuer.name} ⇄ ${redeemer.name} (code ${code})`);
  return jsonResponse({
    friend: {
      agent_id: issuer.agent_id,
      name: issuer.name,
      handle: issuerOwner?.handle && issuer.handle ? `@${issuerOwner.handle}/${issuer.handle}` : null,
      public_key: issuer.public_key,
      access_policy: issuer.access_policy,
      status: issuer.status,
      owner_public_key: issuerOwner?.owner_public_key ?? null,
    },
    pinned_key: issuer.public_key,
    note: 'Friendship established — both keys pinned. Pin this public_key locally; if it ever changes, verify with the human before trusting.',
  });
}

/**
 * GET /friends?agent_id= — list this agent's friendships. Agent auth.
 */
async function handleFriendsList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const auth = await requireAgentAuth(req, url.searchParams.get('agent_id'));
  if ('error' in auth) return auth.error;
  const me = auth.agent;

  const supabase = getSupabaseAdmin();
  const { data: edges } = await supabase
    .from('friendships')
    .select('agent_lo, agent_hi, pinned_key_lo, pinned_key_hi, default_visibility, sealed_required, created_at')
    .or(`agent_lo.eq.${me.agent_id},agent_hi.eq.${me.agent_id}`);

  const friends = [];
  for (const e of edges || []) {
    const friendId = e.agent_lo === me.agent_id ? e.agent_hi : e.agent_lo;
    const pinnedKey = e.agent_lo === me.agent_id ? e.pinned_key_hi : e.pinned_key_lo;
    const { data: card } = await supabase
      .from('agents')
      .select('agent_id, name, handle, access_policy, status, public_key, last_seen_at, owners:owner_id(handle)')
      .eq('agent_id', friendId)
      .single();
    if (!card) continue;
    // deno-lint-ignore no-explicit-any
    const ownerJoin = card.owners as any;
    friends.push({
      agent_id: card.agent_id,
      name: card.name,
      handle: ownerJoin?.handle && card.handle ? `@${ownerJoin.handle}/${card.handle}` : null,
      access_policy: card.access_policy,
      status: card.status,
      last_seen_at: card.last_seen_at,
      pinned_key: pinnedKey,
      current_key: card.public_key,
      key_changed: pinnedKey !== card.public_key,
      default_visibility: e.default_visibility,
      sealed_required: e.sealed_required,
      friends_since: e.created_at,
    });
  }

  return jsonResponse({ friends, total: friends.length });
}

/**
 * POST /friends/policy — set the RFC 004 privacy policy for a friendship.
 * Body: { agent_id, friend_agent_id, default_visibility?, sealed_required? }
 * Agent auth; the caller must be one of the two friends. Either friend may
 * change the policy (v1 — mutual-consent-for-relaxation is a future refinement).
 */
async function handleFriendPolicy(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const auth = await requireAgentAuth(req, body.agent_id);
  if ('error' in auth) return auth.error;
  const me = auth.agent;

  const friendId = body.friend_agent_id;
  const friendIdErrors = validateUUID(friendId, 'friend_agent_id');
  if (friendIdErrors.length > 0) return validationErrorResponse(friendIdErrors);

  const vis = body.default_visibility as string | undefined;
  if (vis !== undefined && !['open', 'summarized', 'private', 'secret'].includes(vis)) {
    return errorResponse("default_visibility must be one of: open, summarized, private, secret", 400);
  }
  const sealedRequired = body.sealed_required;
  if (sealedRequired !== undefined && typeof sealedRequired !== 'boolean') {
    return errorResponse('sealed_required must be a boolean', 400);
  }
  if (vis === undefined && sealedRequired === undefined) {
    return errorResponse('Provide default_visibility and/or sealed_required', 400);
  }

  const { lo, hi } = friendPair(me.agent_id, friendId as string);
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('friendships')
    .select('default_visibility, sealed_required')
    .eq('agent_lo', lo)
    .eq('agent_hi', hi)
    .maybeSingle();
  if (!existing) {
    return errorResponse('You are not friends with that agent', 403, { error_code: 'not_friends' });
  }

  const update: Record<string, unknown> = {};
  if (vis !== undefined) update.default_visibility = vis;
  if (sealedRequired !== undefined) update.sealed_required = sealedRequired;

  const { error } = await supabase
    .from('friendships')
    .update(update)
    .eq('agent_lo', lo)
    .eq('agent_hi', hi);
  if (error) {
    console.error('[OACP] Friend policy update error:', error);
    return errorResponse('Failed to update friendship policy', 500);
  }

  return jsonResponse({
    friend_agent_id: friendId,
    default_visibility: vis ?? existing.default_visibility,
    sealed_required: sealedRequired ?? existing.sealed_required,
    note: 'Friendship privacy policy updated. It governs new threads between the two of you and whether the registry requires sealing.',
  });
}

/**
 * POST /agents/set-access — set this agent's access policy (RFC 002 §3.5).
 * Body: { agent_id, access_policy: 'open' | 'closed' }. Agent auth.
 */
async function handleSetAccess(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.access_policy !== 'open' && body.access_policy !== 'closed') {
    return errorResponse("access_policy must be 'open' or 'closed'", 400);
  }

  const auth = await requireAgentAuth(req, body.agent_id);
  if ('error' in auth) return auth.error;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('agents')
    .update({ access_policy: body.access_policy })
    .eq('agent_id', auth.agent.agent_id);
  if (error) {
    console.error('[OACP] Set access error:', error);
    return errorResponse('Failed to update access policy', 500);
  }

  return jsonResponse({
    agent_id: auth.agent.agent_id,
    access_policy: body.access_policy,
    note: body.access_policy === 'closed'
      ? 'Closed: the registry now only accepts messages from friends (plus replies on threads this agent started). Mint codes with oacp_friend_code.'
      : 'Open: anyone can message this agent; non-friends are rate limited per sender.',
  });
}

/**
 * POST /messages/send — Send a message between agents
 *
 * REQ-MSG-01: Conforms to OACP Message Envelope schema
 * REQ-MSG-02: Routes envelope from sender to recipient
 * REQ-MSG-03: Recipient receives via Supabase Realtime
 * REQ-MSG-04: At-least-once delivery
 * REQ-MSG-05: Stores all messages for audit and replay
 */
async function handleMessageSend(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate required fields
  const requiredErrors = validateRequired(body, [
    'recipient_agent_id',
    'message_type',
    'signature',
  ]);
  if (requiredErrors.length > 0) {
    return validationErrorResponse(requiredErrors);
  }

  // Validate recipient is a UUID
  const recipientErrors = validateUUID(body.recipient_agent_id, 'recipient_agent_id');
  if (recipientErrors.length > 0) {
    return validationErrorResponse(recipientErrors);
  }

  // Validate message_type
  const validTypes = ['task_request', 'task_ack', 'task_result', 'task_error', 'task_progress', 'chat'];
  if (!validTypes.includes(body.message_type as string)) {
    return errorResponse(
      `message_type must be one of: ${validTypes.join(', ')}`,
      400,
    );
  }

  // Validate payload is an object
  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload))) {
    return errorResponse('payload must be a JSON object', 400);
  }

  // Authenticate sender via Bearer token
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Look up sender by token
  // We need the sender's agent_id and public_key
  // The sender is identified by their Bearer token
  const senderAgentId = body.sender_agent_id as string | undefined;
  if (!senderAgentId) {
    return errorResponse('sender_agent_id is required', 400);
  }

  const senderIdErrors = validateUUID(senderAgentId, 'sender_agent_id');
  if (senderIdErrors.length > 0) {
    return validationErrorResponse(senderIdErrors);
  }

  // Verify sender exists and token matches
  const { data: sender, error: senderError } = await supabase
    .from('agents')
    .select('agent_id, public_key, registry_token, name')
    .eq('agent_id', senderAgentId)
    .single();

  if (senderError || !sender) {
    return errorResponse('Sender agent not found', 404);
  }

  if (sender.registry_token !== tokenHash) {
    return errorResponse('Invalid registry token', 403);
  }

  // Verify recipient exists
  const { data: recipient, error: recipientError } = await supabase
    .from('agents')
    .select('agent_id, name, access_policy, metadata, registry_token, owner_id')
    .eq('agent_id', body.recipient_agent_id)
    .single();

  if (recipientError || !recipient) {
    return errorResponse('Recipient agent not found', 404);
  }

  const isSealed = (body.payload as Record<string, unknown> | undefined)?.sealed === true;

  // RFC 002 §3.5: access policy — closed agents accept friends only (with a
  // reply carve-out for threads the closed agent started).
  // RFC 004: the friendship also carries a privacy policy applied below.
  // RFC 005: the inbound trust boundary for non-friends — blocked senders
  // bounce, free text is friends-only, task_requests are schema-checked
  // against declared actions, first contact quarantines, and flagged
  // senders are throttled then suspended.
  const friendship = await getFriendship(senderAgentId, recipient.agent_id);
  const senderIsFriend = friendship !== null;
  let deliveryStatus: 'delivered' | 'quarantined' = 'delivered';
  if (!senderIsFriend) {
    const contactStatus = await getContactStatus(recipient.agent_id, senderAgentId);
    if (contactStatus === 'blocked') {
      return errorResponse(
        `${recipient.name} has blocked messages from this agent.`,
        403,
        { error_code: 'sender_blocked' },
      );
    }

    // Reply carve-out: the recipient reached out first on this thread, so
    // responses flow without stranger restrictions (RFC 002 §3.5, extended
    // to every recipient by RFC 005 — being messaged first IS the invite).
    let replyAllowed = false;
    if (body.correlation_id) {
      const { data: prior } = await supabase
        .from('messages')
        .select('message_id')
        .eq('correlation_id', body.correlation_id as string)
        .eq('sender_agent_id', recipient.agent_id)
        .eq('recipient_agent_id', senderAgentId)
        .limit(1);
      replyAllowed = !!prior && prior.length > 0;
    }

    if (recipient.access_policy === 'closed' && !replyAllowed) {
      return errorResponse(
        `${recipient.name} only accepts messages from friends. Ask their human for a friend code, then redeem it (oacp_add_friend).`,
        403,
        { error_code: 'not_friends', access_policy: 'closed' },
      );
    }

    if (!replyAllowed) {
      // RFC 005 §4: flag-based suspension. Distinct recipients flagging this
      // sender inside 7 days: ≥5 suspends stranger sends, ≥2 tightens the
      // pair rate limit below. Friend messaging is never affected.
      const { data: flagData } = await supabase.rpc('oacp_sender_flag_count', {
        p_sender: senderAgentId,
        p_days: 7,
      });
      const flaggerCount = typeof flagData === 'number' ? flagData : 0;
      if (flaggerCount >= 5) {
        return errorResponse(
          'This agent has been flagged by multiple recipients in the last 7 days and cannot message non-friends right now. Messaging friends still works; the suspension lifts as flags age out.',
          403,
          { error_code: 'flag_suspended', distinct_flaggers_7d: flaggerCount },
        );
      }

      // RFC 005 §2: structured-only strangers. Free text reaches a model's
      // context; strangers don't get to put words there.
      if (body.message_type === 'chat') {
        return errorResponse(
          `Free-text chat is a friends-only privilege — you and ${recipient.name} are not friends. Send a structured task_request against a declared action, or ask their human for a friend code (oacp_add_friend).`,
          403,
          { error_code: 'chat_requires_friendship' },
        );
      }
      if (body.message_type !== 'task_request') {
        return errorResponse(
          `${body.message_type} from a non-friend is only valid as a reply on a thread the recipient started — include that thread's correlation_id.`,
          403,
          { error_code: 'reply_without_thread' },
        );
      }
      if (isSealed) {
        return errorResponse(
          'Sealed payloads between non-friends are not allowed — the registry must be able to inspect stranger traffic (RFC 005). Establish a friendship for end-to-end encrypted messaging.',
          400,
          { error_code: 'sealed_requires_friendship' },
        );
      }

      // Schema-check the request against the recipient's advertised actions.
      // No declared actions → nothing to validate against; the message still
      // quarantines below and arrives provenance-framed.
      const specs = (recipient.metadata as Record<string, unknown> | null)
        ?.action_specs;
      if (Array.isArray(specs) && specs.length > 0) {
        const requestedAction = (body.payload as Record<string, unknown> | undefined)
          ?.action;
        const availableNames = specs
          .map((s) => (s as Record<string, unknown>).name)
          .filter((n) => typeof n === 'string');
        const spec = typeof requestedAction === 'string'
          ? specs.find((s) => (s as Record<string, unknown>).name === requestedAction)
          : (specs.length === 1 ? specs[0] : undefined);
        if (!spec) {
          return errorResponse(
            typeof requestedAction === 'string'
              ? `Unknown action "${requestedAction}" — ${recipient.name} accepts: ${availableNames.join(', ')}`
              : `Non-friends must invoke a declared action — set payload.action. ${recipient.name} accepts: ${availableNames.join(', ')}`,
            400,
            { error_code: 'unknown_action', available_actions: availableNames },
          );
        }
        const inputSchema = (spec as Record<string, unknown>).input_schema;
        if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
          const result = validateSimpleSchema(
            body.payload,
            inputSchema as SimpleSchema,
          );
          if (!result.valid) {
            return errorResponse(
              'Payload does not match the declared input schema for this action',
              400,
              { error_code: 'invalid_payload', validation_errors: result.errors },
            );
          }
        }
      }

      // RFC 005 §3: first-contact quarantine. Until the recipient accepts
      // this sender, messages are stored payload-withheld; accepting the
      // contact releases everything held.
      if (contactStatus !== 'accepted') {
        deliveryStatus = 'quarantined';
      }

      const maxPerHour = flaggerCount >= 2 ? 2 : 20;
      const { data: pairAllowed } = await supabase.rpc('oacp_check_rate_limit', {
        p_identifier: `pair:${senderAgentId}:${recipient.agent_id}`,
        p_endpoint: '/messages/send-pair',
        p_window_seconds: 3600,
        p_max_requests: maxPerHour,
      });
      if (pairAllowed === false) {
        return errorResponse(
          `Rate limit exceeded for messages to this recipient (${maxPerHour}/hour for non-friends${flaggerCount >= 2 ? ', tightened while this agent carries recent flags' : ''}). Establish a friendship (friend code) for unlimited messaging.`,
          429,
          { error_code: 'pair_rate_limited' },
        );
      }
    }
  }

  // RFC 001: visibility tier — validated here, applied at thread creation below
  const VISIBILITY_TIERS = ['open', 'summarized', 'private', 'secret'];
  const requestedVisibility = body.visibility as string | undefined;
  if (requestedVisibility !== undefined && !VISIBILITY_TIERS.includes(requestedVisibility)) {
    return errorResponse(`visibility must be one of: ${VISIBILITY_TIERS.join(', ')}`, 400);
  }
  const requestedSummary = body.public_summary as string | undefined;
  if (requestedSummary !== undefined && (typeof requestedSummary !== 'string' || requestedSummary.length > 200)) {
    return errorResponse('public_summary must be a string of at most 200 characters', 400);
  }

  // RFC 004: private-by-default between friends. Enforced on EVERY message
  // between the pair, on any correlation_id — this is what closes the
  // "reply on a brand-new open thread" leak that thread-level rules miss.
  if (friendship?.sealed_required && !isSealed) {
    return errorResponse(
      `You and ${recipient.name} are friends with a sealed channel — messages must be end-to-end encrypted. Send with seal: true, or relax the channel via /friends/policy.`,
      400,
      { error_code: 'seal_required_by_friendship' },
    );
  }

  // Thread control: reject sends on paused/ended threads; resolve visibility
  let threadVisibility: string | null = null;
  if (body.correlation_id) {
    const { data: threadState } = await supabase
      .from('thread_states')
      .select('status, visibility')
      .eq('correlation_id', body.correlation_id as string)
      .maybeSingle();

    if (threadState && threadState.status !== 'active') {
      return errorResponse(
        `Thread is ${threadState.status} — no further messages can be sent on this correlation_id`,
        403,
        { error_code: `thread_${threadState.status}`, correlation_id: body.correlation_id },
      );
    }

    if (threadState) {
      // Existing thread: its tier is settled; send-time visibility is ignored
      // (tier changes go through POST /threads/update, upgrades only).
      threadVisibility = threadState.visibility;
    } else {
      // Thread creation. Precedence: explicit request → friendship default
      // (RFC 004) → sealed-implies-private → global open default. A new thread
      // between friends inherits the pair's default_visibility, so a
      // counterparty opening a fresh thread can't accidentally publish it.
      threadVisibility = requestedVisibility
        ?? friendship?.default_visibility
        ?? (isSealed ? 'private' : 'open');
    }

    if (isSealed && (threadVisibility === 'open' || threadVisibility === 'summarized')) {
      return errorResponse(
        `Sealed payloads are not allowed on '${threadVisibility}' threads — observers are promised readable contents. Use visibility 'private' or 'secret', or send unsealed.`,
        400,
        { error_code: 'seal_visibility_conflict', visibility: threadVisibility },
      );
    }

    if (!threadState && (threadVisibility !== 'open' || requestedSummary !== undefined)) {
      // Materialize the thread state BEFORE the message insert so the feed
      // projection trigger sees the tier. public_summary only exists on
      // observer-visible tiers.
      const { error: tsError } = await supabase.from('thread_states').upsert({
        correlation_id: body.correlation_id as string,
        status: 'active',
        visibility: threadVisibility,
        public_summary:
          (threadVisibility === 'open' || threadVisibility === 'summarized') && requestedSummary
            ? requestedSummary
            : null,
        set_by_agent_id: senderAgentId,
      }, { onConflict: 'correlation_id', ignoreDuplicates: true });
      if (tsError) {
        console.error('[OACP] Thread state create error:', tsError);
        return errorResponse('Failed to create thread state', 500);
      }
    }
  }

  // Verify Ed25519 signature
  const payload = (body.payload as Record<string, unknown>) || {};
  // Normalize null/undefined for consistent canonicalization
  const correlationId = (body.correlation_id as string) || undefined;
  const sequence = (body.sequence as number) ?? undefined;

  const canonicalMsg = canonicalizeMessage({
    sender_agent_id: senderAgentId,
    recipient_agent_id: body.recipient_agent_id as string,
    message_type: body.message_type as string,
    payload,
    correlation_id: correlationId,
    sequence: sequence,
  });

  const signatureValid = verifyMessageSignature(
    body.signature as string,
    canonicalMsg,
    sender.public_key,
  );

  if (!signatureValid) {
    return errorResponse('Invalid message signature', 403, {
      detail: 'Ed25519 signature verification failed for the canonical message content',
    });
  }

  // Insert message
  const now = new Date().toISOString();
  const insertData = {
    sender_agent_id: senderAgentId,
    recipient_agent_id: body.recipient_agent_id as string,
    message_type: body.message_type as string,
    payload,
    signature: body.signature as string,
    correlation_id: (body.correlation_id as string) || null,
    sequence: (body.sequence as number) || null,
    created_at: now,
    delivery_status: deliveryStatus,
  };

  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert(insertData)
    .select('message_id, created_at')
    .single();

  if (insertError) {
    console.error('[OACP] Message insert error:', insertError);
    return errorResponse('Failed to store message', 500);
  }

  console.log(
    `[OACP] Message ${message.message_id} sent: ${sender.name} → ${recipient.name} (${body.message_type})`,
  );

  // RFC 006 Phase 2: a held message needs a HUMAN, not the agent — tell them.
  // Fire-and-forget so notification latency never delays the send response.
  if (deliveryStatus === 'quarantined') {
    void notifyQuarantine(
      {
        agent_id: recipient.agent_id,
        name: recipient.name,
        owner_id: (recipient.owner_id as string | null) ?? null,
      },
      { agent_id: senderAgentId, name: sender.name },
      message.message_id,
    );
  }

  // RFC 006: wake the recipient over its private broadcast channel. Envelope
  // metadata only — never the payload; the recipient fetches content through
  // the authenticated REST inbox, which applies quarantine redaction.
  if (recipient.registry_token) {
    await pushNotify(recipient.agent_id, recipient.registry_token as string, {
      message_id: message.message_id,
      sender_agent_id: senderAgentId,
      message_type: body.message_type,
      correlation_id: (body.correlation_id as string) || null,
      delivery_status: deliveryStatus,
      created_at: message.created_at,
    });
  }

  return jsonResponse(
    {
      message_id: message.message_id,
      sender_agent_id: senderAgentId,
      recipient_agent_id: body.recipient_agent_id,
      message_type: body.message_type,
      created_at: message.created_at,
      visibility: threadVisibility ?? 'open',
      delivery_status: deliveryStatus,
      ...(deliveryStatus === 'quarantined'
        ? {
          note:
            `First contact — ${recipient.name} has not accepted this agent as a contact yet, so the message is held payload-withheld until their side accepts. It is not lost; acceptance releases it.`,
        }
        : {}),
    },
    201,
  );
}

/**
 * GET /messages — Retrieve messages for an agent
 *
 * Query params:
 *   agent_id (required) — the agent whose messages to retrieve
 *   direction — 'inbox' (default) or 'outbox'
 *   message_type — filter by type
 *   correlation_id — filter by conversation
 *   since — ISO timestamp, return only messages after this time
 *   limit — max results (default 50, max 100)
 */
async function handleGetMessages(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');
  const direction = url.searchParams.get('direction') || 'inbox';
  const messageType = url.searchParams.get('message_type');
  const correlationId = url.searchParams.get('correlation_id');
  const since = url.searchParams.get('since');
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

  if (!agentId) {
    return errorResponse('agent_id query parameter is required', 400);
  }

  const idErrors = validateUUID(agentId, 'agent_id');
  if (idErrors.length > 0) {
    return validationErrorResponse(idErrors);
  }

  // Authenticate — must provide Bearer token matching the agent
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent, error: authError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', agentId)
    .single();

  if (authError || !agent) {
    return errorResponse('Agent not found', 404);
  }

  if (agent.registry_token !== tokenHash) {
    return errorResponse('Invalid registry token', 403);
  }

  // Build query
  let query = supabase
    .from('messages')
    .select('*', { count: 'exact' });

  if (direction === 'outbox') {
    query = query.eq('sender_agent_id', agentId);
  } else {
    query = query.eq('recipient_agent_id', agentId);
  }

  if (messageType) {
    query = query.eq('message_type', messageType);
  }
  if (correlationId) {
    query = query.eq('correlation_id', correlationId);
  }
  if (since) {
    query = query.gt('created_at', since);
  }

  query = query
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: messages, error: queryError, count } = await query;

  if (queryError) {
    console.error('[OACP] Messages query error:', queryError);
    return errorResponse('Failed to retrieve messages', 500);
  }

  // RFC 005: enrich every message with counterpart provenance (who sent it,
  // verified identity, relationship to this agent) so downstream clients can
  // frame external content, and redact quarantined inbox payloads.
  const rows = (messages || []) as Record<string, unknown>[];
  const isInbox = direction !== 'outbox';
  const counterpartIds = [
    ...new Set(
      rows.map((m) =>
        (isInbox ? m.sender_agent_id : m.recipient_agent_id) as string
      ),
    ),
  ];

  const agentInfo: Record<
    string,
    { name: string | null; handle: string | null; owner_handle: string | null }
  > = {};
  const friendIds = new Set<string>();
  const contactStatusBySender: Record<string, string> = {};

  if (counterpartIds.length > 0) {
    // RFC 002: agents.handle is only the agent segment — the verified,
    // fully-qualified handle needs the owner's claimed handle joined in.
    // Provenance is the whole point here, so it must be the real one.
    const { data: infoRows } = await supabase
      .from('agents')
      .select('agent_id, name, handle, owner_handle, owners:owner_id(handle)')
      .in('agent_id', counterpartIds);
    for (const r of infoRows || []) {
      const ownerJoin = r.owners as unknown as { handle?: string } | null;
      const fullHandle = ownerJoin?.handle && r.handle
        ? `@${ownerJoin.handle}/${r.handle}`
        : null;
      agentInfo[r.agent_id as string] = {
        name: (r.name as string) ?? null,
        handle: fullHandle,
        owner_handle: (r.owner_handle as string) ?? null,
      };
    }

    const { data: fRows } = await supabase
      .from('friendships')
      .select('agent_lo, agent_hi')
      .or(`agent_lo.eq.${agentId},agent_hi.eq.${agentId}`);
    for (const f of fRows || []) {
      friendIds.add(
        (f.agent_lo === agentId ? f.agent_hi : f.agent_lo) as string,
      );
    }

    if (isInbox) {
      const { data: cRows } = await supabase
        .from('contacts')
        .select('sender_agent_id, status')
        .eq('recipient_agent_id', agentId)
        .in('sender_agent_id', counterpartIds);
      for (const c of cRows || []) {
        contactStatusBySender[c.sender_agent_id as string] = c.status as string;
      }
    }
  }

  const enriched = rows.map((m) => {
    const cpId = (isInbox ? m.sender_agent_id : m.recipient_agent_id) as string;
    const info = agentInfo[cpId];
    const relationship = friendIds.has(cpId)
      ? 'friend'
      : contactStatusBySender[cpId] === 'accepted'
      ? 'accepted_contact'
      : contactStatusBySender[cpId] === 'blocked'
      ? 'blocked'
      : 'stranger';
    const counterpart = {
      agent_id: cpId,
      name: info?.name ?? null,
      handle: info?.handle ?? null,
      owner_handle: info?.owner_handle ?? null,
      domain_verified: isDomainVerifiedHandle(info?.handle),
      relationship,
    };
    const out: Record<string, unknown> = {
      ...m,
      [isInbox ? 'sender_info' : 'recipient_info']: counterpart,
    };

    if (isInbox && m.delivery_status === 'quarantined') {
      const rawPayload = m.payload;
      const action =
        rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
          ? (rawPayload as Record<string, unknown>).action
          : undefined;
      out.payload = {
        quarantined: true,
        ...(typeof action === 'string' ? { action } : {}),
        payload_bytes: JSON.stringify(rawPayload ?? {}).length,
        note:
          'First contact from an unknown sender — payload withheld until this agent accepts the contact (oacp_contact / POST /contacts/set). Accepting releases every held message from this sender; blocking discards future sends.',
      };
    }
    return out;
  });

  return jsonResponse({
    messages: enriched,
    total: count || 0,
    limit,
  });
}

// ============================================================
// RFC 005: Contacts + Flags
// ============================================================

/**
 * Authenticate a request as a specific agent — either by the agent's own
 * registry token, or by its human owner's signed-in session (RFC 003 owner
 * account JWT).
 *
 * The owner path is what lets the dashboard act as the consent gate: RFC 005
 * makes a human responsible for accepting or blocking unknown senders, and a
 * human at a browser has an owner session, never the agent's registry token.
 */
async function authenticateAgentOrOwner(
  req: Request,
  agentId: string,
): Promise<{ ok: true; via: 'agent' | 'owner' } | { ok: false; response: Response }> {
  const token = extractBearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: errorResponse('Authorization header with Bearer token required', 401),
    };
  }
  const supabase = getSupabaseAdmin();
  const { data: agent, error } = await supabase
    .from('agents')
    .select('agent_id, registry_token, owner_id')
    .eq('agent_id', agentId)
    .single();
  if (error || !agent) {
    return { ok: false, response: errorResponse('Agent not found', 404) };
  }

  const tokenHash = await hashToken(token);
  if (agent.registry_token === tokenHash) {
    return { ok: true, via: 'agent' };
  }

  // Not the agent's token — is it the owner's session for this agent?
  if (agent.owner_id) {
    try {
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user?.id && userData.user.id === agent.owner_id) {
        return { ok: true, via: 'owner' };
      }
    } catch {
      // fall through to the generic failure below
    }
  }

  return {
    ok: false,
    response: errorResponse(
      'Invalid registry token, and not a signed-in owner session for this agent',
      403,
    ),
  };
}

/**
 * POST /contacts/set — accept or block a non-friend sender (RFC 005 §3).
 * Body: { agent_id, sender_agent_id, status: 'accepted' | 'blocked' }
 * Accepting releases every quarantined message held from that sender.
 */
async function handleContactsSet(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const requiredErrors = validateRequired(body, ['agent_id', 'sender_agent_id', 'status']);
  if (requiredErrors.length > 0) return validationErrorResponse(requiredErrors);
  const idErrors = [
    ...validateUUID(body.agent_id, 'agent_id'),
    ...validateUUID(body.sender_agent_id, 'sender_agent_id'),
  ];
  if (idErrors.length > 0) return validationErrorResponse(idErrors);
  if (body.status !== 'accepted' && body.status !== 'blocked') {
    return errorResponse("status must be 'accepted' or 'blocked'", 400);
  }
  if (body.agent_id === body.sender_agent_id) {
    return errorResponse('agent_id and sender_agent_id must differ', 400);
  }

  const auth = await authenticateAgentOrOwner(req, body.agent_id as string);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();

  const { data: sender } = await supabase
    .from('agents')
    .select('agent_id, name')
    .eq('agent_id', body.sender_agent_id)
    .single();
  if (!sender) return errorResponse('Sender agent not found', 404);

  const { error: upsertError } = await supabase.from('contacts').upsert({
    recipient_agent_id: body.agent_id as string,
    sender_agent_id: body.sender_agent_id as string,
    status: body.status as string,
    decided_via: 'manual',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'recipient_agent_id,sender_agent_id' });
  if (upsertError) {
    console.error('[OACP] Contact upsert error:', upsertError);
    return errorResponse('Failed to save contact decision', 500);
  }

  let released = 0;
  if (body.status === 'accepted') {
    const { data: releasedRows, error: releaseError } = await supabase
      .from('messages')
      .update({ delivery_status: 'delivered' })
      .eq('recipient_agent_id', body.agent_id as string)
      .eq('sender_agent_id', body.sender_agent_id as string)
      .eq('delivery_status', 'quarantined')
      .select('message_id');
    if (releaseError) {
      console.error('[OACP] Quarantine release error:', releaseError);
      return errorResponse('Contact saved but releasing held messages failed', 500);
    }
    released = releasedRows?.length ?? 0;
  }

  console.log(
    `[OACP] Contact decision: ${body.agent_id} ${body.status} ${sender.name} (${released} released)`,
  );

  return jsonResponse({
    recipient_agent_id: body.agent_id,
    sender_agent_id: body.sender_agent_id,
    sender_name: sender.name,
    status: body.status,
    released_messages: released,
  });
}

/**
 * GET /contacts?agent_id= — list this agent's contact decisions.
 */
async function handleContactsList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');
  if (!agentId) return errorResponse('agent_id query parameter is required', 400);
  const idErrors = validateUUID(agentId, 'agent_id');
  if (idErrors.length > 0) return validationErrorResponse(idErrors);

  const auth = await authenticateAgentOrOwner(req, agentId);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from('contacts')
    .select('sender_agent_id, status, decided_via, created_at, updated_at, sender:sender_agent_id(name, handle, owner_handle)')
    .eq('recipient_agent_id', agentId)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[OACP] Contacts list error:', error);
    return errorResponse('Failed to list contacts', 500);
  }

  return jsonResponse({
    contacts: (rows || []).map((r) => {
      const sender = r.sender as unknown as
        | { name?: string; handle?: string; owner_handle?: string }
        | null;
      return {
        sender_agent_id: r.sender_agent_id,
        name: sender?.name ?? null,
        handle: sender?.handle ?? null,
        owner_handle: sender?.owner_handle ?? null,
        status: r.status,
        decided_via: r.decided_via,
        updated_at: r.updated_at,
      };
    }),
  });
}

/**
 * POST /messages/flag — report a hostile inbound message (RFC 005 §4).
 * Body: { agent_id, message_id, reason, note?, block? }
 * Only the message's recipient may flag it. block: true also blocks the sender.
 */
async function handleMessageFlag(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const requiredErrors = validateRequired(body, ['agent_id', 'message_id', 'reason']);
  if (requiredErrors.length > 0) return validationErrorResponse(requiredErrors);
  const idErrors = [
    ...validateUUID(body.agent_id, 'agent_id'),
    ...validateUUID(body.message_id, 'message_id'),
  ];
  if (idErrors.length > 0) return validationErrorResponse(idErrors);

  const REASONS = ['prompt_injection', 'spam', 'abuse', 'other'];
  if (!REASONS.includes(body.reason as string)) {
    return errorResponse(`reason must be one of: ${REASONS.join(', ')}`, 400);
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) {
    return errorResponse('note must be a string of at most 500 characters', 400);
  }

  const auth = await authenticateAgentOrOwner(req, body.agent_id as string);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: result, error } = await supabase.rpc('oacp_register_flag', {
    p_message_id: body.message_id as string,
    p_flagged_by: body.agent_id as string,
    p_reason: body.reason as string,
    p_note: (body.note as string) ?? null,
  });
  if (error) {
    console.error('[OACP] Flag RPC error:', error);
    return errorResponse('Failed to record flag', 500);
  }

  const flagResult = result as Record<string, unknown>;
  if (flagResult.error === 'message_not_found') {
    return errorResponse('Message not found', 404);
  }
  if (flagResult.error === 'not_recipient') {
    return errorResponse('Only the recipient of a message can flag it', 403);
  }
  if (flagResult.error === 'cannot_flag_own_message') {
    return errorResponse('Cannot flag your own message', 400);
  }

  let blocked = false;
  if (body.block === true) {
    const { error: blockError } = await supabase.from('contacts').upsert({
      recipient_agent_id: body.agent_id as string,
      sender_agent_id: flagResult.sender_agent_id as string,
      status: 'blocked',
      decided_via: 'manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'recipient_agent_id,sender_agent_id' });
    blocked = !blockError;
  }

  console.log(
    `[OACP] Flag: ${body.agent_id} flagged message ${body.message_id} (${body.reason})${blocked ? ' + blocked sender' : ''}`,
  );

  return jsonResponse({
    ...flagResult,
    ...(body.block === true ? { sender_blocked: blocked } : {}),
  });
}

/**
 * GET /approvals/pending?token= — describe the decision a token authorizes.
 *
 * READ ONLY, deliberately. Mail clients and link scanners prefetch URLs; if
 * following the link performed the accept, a spam filter could befriend an
 * attacker on the owner's behalf. Consuming the token requires POST below.
 */
async function handleApprovalDescribe(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return errorResponse('token query parameter is required', 400);

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from('approval_tokens')
    .select('token, kind, agent_id, subject_id, expires_at, consumed_at, consumed_as')
    .eq('token', token)
    .maybeSingle();

  if (!row) return errorResponse('Unknown or revoked approval link', 404, { error_code: 'token_not_found' });
  if (row.consumed_at) {
    return jsonResponse({
      state: 'already_decided',
      decided_as: row.consumed_as,
      decided_at: row.consumed_at,
    });
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return jsonResponse({ state: 'expired', expires_at: row.expires_at });
  }

  const { data: pair } = await supabase
    .from('agents')
    .select('agent_id, name, handle, owner_handle, description, capabilities, owners:owner_id(handle)')
    .in('agent_id', [row.agent_id, row.subject_id]);
  const fullHandleOf = (a: Record<string, unknown> | undefined): string | null => {
    if (!a) return null;
    const ownerJoin = a.owners as { handle?: string } | null;
    return ownerJoin?.handle && a.handle ? `@${ownerJoin.handle}/${a.handle}` : null;
  };
  const mine = (pair ?? []).find((a) => a.agent_id === row.agent_id);
  const theirs = (pair ?? []).find((a) => a.agent_id === row.subject_id);

  const { count } = await supabase
    .from('messages')
    .select('message_id', { count: 'exact', head: true })
    .eq('recipient_agent_id', row.agent_id)
    .eq('sender_agent_id', row.subject_id)
    .eq('delivery_status', 'quarantined');

  return jsonResponse({
    state: 'pending',
    kind: row.kind,
    your_agent: mine
      ? { agent_id: mine.agent_id, name: mine.name, handle: fullHandleOf(mine) }
      : null,
    sender: theirs
      ? {
        agent_id: theirs.agent_id,
        name: theirs.name,
        handle: fullHandleOf(theirs),
        owner_handle: theirs.owner_handle,
        description: theirs.description,
        capabilities: theirs.capabilities,
        domain_verified: isDomainVerifiedHandle(fullHandleOf(theirs)),
      }
      : null,
    held_messages: count ?? 0,
    expires_at: row.expires_at,
  });
}

/**
 * POST /approvals/decide — consume an approval token and apply the decision.
 * Body: { token, decision: 'accepted' | 'blocked' }
 * Single-use: the token is marked consumed in the same step.
 */
async function handleApprovalDecide(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const requiredErrors = validateRequired(body, ['token', 'decision']);
  if (requiredErrors.length > 0) return validationErrorResponse(requiredErrors);
  if (body.decision !== 'accepted' && body.decision !== 'blocked') {
    return errorResponse("decision must be 'accepted' or 'blocked'", 400);
  }

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from('approval_tokens')
    .select('token, agent_id, subject_id, expires_at, consumed_at, consumed_as')
    .eq('token', body.token as string)
    .maybeSingle();

  if (!row) return errorResponse('Unknown or revoked approval link', 404, { error_code: 'token_not_found' });
  if (row.consumed_at) {
    return errorResponse(
      `This link was already used (${row.consumed_as}). Open the dashboard to change the decision.`,
      409,
      { error_code: 'token_consumed', decided_as: row.consumed_as },
    );
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return errorResponse('This approval link has expired. Decide from the dashboard instead.', 410, {
      error_code: 'token_expired',
    });
  }

  // Consume first, conditionally on it still being unconsumed — two clicks
  // racing must not both apply.
  const { data: claimed, error: claimError } = await supabase
    .from('approval_tokens')
    .update({ consumed_at: new Date().toISOString(), consumed_as: body.decision as string })
    .eq('token', row.token as string)
    .is('consumed_at', null)
    .select('token');
  if (claimError || !claimed || claimed.length === 0) {
    return errorResponse('This link was just used from somewhere else.', 409, {
      error_code: 'token_consumed',
    });
  }

  const { error: upsertError } = await supabase.from('contacts').upsert({
    recipient_agent_id: row.agent_id as string,
    sender_agent_id: row.subject_id as string,
    status: body.decision as string,
    decided_via: 'manual',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'recipient_agent_id,sender_agent_id' });
  if (upsertError) {
    console.error('[OACP] Approval upsert error:', upsertError);
    return errorResponse('Failed to save the decision', 500);
  }

  let released = 0;
  if (body.decision === 'accepted') {
    const { data: rows } = await supabase
      .from('messages')
      .update({ delivery_status: 'delivered' })
      .eq('recipient_agent_id', row.agent_id as string)
      .eq('sender_agent_id', row.subject_id as string)
      .eq('delivery_status', 'quarantined')
      .select('message_id');
    released = rows?.length ?? 0;
  }

  return jsonResponse({
    decision: body.decision,
    released_messages: released,
  });
}

/**
 * GET/POST /notifications/channels — an owner's notification destinations.
 * Owner-authenticated via Supabase session JWT.
 */
async function handleNotificationChannels(req: Request): Promise<Response> {
  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization header with Bearer token required', 401);

  const supabase = getSupabaseAdmin();
  const { data: userData } = await supabase.auth.getUser(token);
  const ownerId = userData?.user?.id;
  if (!ownerId) return errorResponse('A signed-in owner session is required', 403);

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('notification_channels')
      .select('channel_id, kind, address, verified_at, enabled, events, created_at')
      .eq('owner_id', ownerId)
      .order('created_at');
    return jsonResponse({ channels: data ?? [] });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Remove a channel
  if (body.remove_channel_id) {
    const { error } = await supabase
      .from('notification_channels')
      .delete()
      .eq('channel_id', body.remove_channel_id as string)
      .eq('owner_id', ownerId);
    if (error) return errorResponse('Failed to remove channel', 500);
    return jsonResponse({ removed: true });
  }

  // Toggle a channel
  if (body.channel_id && body.enabled !== undefined) {
    const { error } = await supabase
      .from('notification_channels')
      .update({ enabled: body.enabled === true, updated_at: new Date().toISOString() })
      .eq('channel_id', body.channel_id as string)
      .eq('owner_id', ownerId);
    if (error) return errorResponse('Failed to update channel', 500);
    return jsonResponse({ updated: true });
  }

  // Add a channel
  const kind = body.kind as string | undefined;
  if (!kind) return errorResponse('kind is required', 400);
  if (!['email', 'telegram'].includes(kind)) {
    return errorResponse("kind must be 'email' or 'telegram' (others not yet dispatchable)", 400);
  }

  // Telegram is a special case: only Telegram knows the chat_id, so there is
  // no address to supply up front. We mint a one-time code, the owner sends
  // it to the bot as `/start <code>`, and the webhook fills in the chat_id.
  if (kind === 'telegram') {
    const linkCode = randomToken(6);
    const { data: pending, error: tgError } = await supabase
      .from('notification_channels')
      .insert({
        owner_id: ownerId,
        kind: 'telegram',
        address: `pending:${linkCode}`,
        verified_at: null,
        verify_token: linkCode,
        updated_at: new Date().toISOString(),
      })
      .select('channel_id')
      .single();
    if (tgError) {
      console.error('[OACP] Telegram channel create error:', tgError);
      return errorResponse('Failed to start Telegram linking', 500);
    }
    const botName = Deno.env.get('TELEGRAM_BOT_USERNAME') || 'LiteneenAlertsBot';
    return jsonResponse({
      channel: { channel_id: pending.channel_id, kind: 'telegram', verified_at: null },
      link_code: linkCode,
      bot_url: `https://t.me/${botName}?start=${linkCode}`,
      instructions:
        `Open the bot and send: /start ${linkCode} — the chat that sends this code becomes the linked one.`,
    }, 201);
  }

  const address = body.address as string | undefined;
  if (!address) return errorResponse('address is required', 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return errorResponse('address must be a valid email', 400);
  }

  // A newly added address is unverified until it proves receipt. The owner's
  // own sign-in email is the exception — Supabase Auth already proved it.
  const { data: owner } = await supabase
    .from('owners')
    .select('email')
    .eq('owner_id', ownerId)
    .maybeSingle();
  const preVerified = !!owner?.email &&
    (owner.email as string).toLowerCase() === address.toLowerCase();

  const verifyToken = preVerified ? null : randomToken(16);
  const { data: inserted, error } = await supabase
    .from('notification_channels')
    .upsert({
      owner_id: ownerId,
      kind,
      address,
      verified_at: preVerified ? new Date().toISOString() : null,
      verify_token: verifyToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,kind,address' })
    .select('channel_id, kind, address, verified_at')
    .single();
  if (error) {
    console.error('[OACP] Channel upsert error:', error);
    return errorResponse('Failed to add channel', 500);
  }

  if (!preVerified) {
    const link = `${DASHBOARD_URL}/?verify_channel=${verifyToken}`;
    await sendEmail(address, {
      subject: 'Confirm this address for Liteneen alerts',
      text:
        `Confirm this address so Liteneen can reach you when one of your agents needs a decision.\n\n${link}\n\n` +
        `If you didn't request this, ignore it — nothing will be sent here.`,
    });
  }

  return jsonResponse({ channel: inserted, verification_sent: !preVerified }, 201);
}

/**
 * POST /notifications/telegram — Telegram Bot API webhook.
 *
 * Linking a Telegram chat needs the chat_id, and only Telegram can tell us
 * that — so the owner opens the bot with a one-time code from the dashboard
 * (`/start <code>`) and this endpoint binds that chat to their account. The
 * code IS the proof of control, same shape as the emailed confirmation link.
 *
 * Public by necessity (Telegram calls it), so it is hardened by a secret path
 * token: Telegram is told to call ?s=<TELEGRAM_WEBHOOK_SECRET> and anything
 * without it is dropped before touching the database.
 */
async function handleTelegramWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (expected && url.searchParams.get('s') !== expected) {
    return errorResponse('Not found', 404);
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return jsonResponse({ ok: true }); // never make Telegram retry a bad body
  }

  const message = (update.message ?? update.edited_message) as
    | Record<string, unknown>
    | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;
  const chatId = chat?.id;
  const text = typeof message?.text === 'string' ? (message.text as string) : '';
  if (!chatId) return jsonResponse({ ok: true });

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const reply = async (body: string) => {
    if (!botToken) return;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'Markdown' }),
    }).catch(() => {});
  };

  const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
  if (!startMatch) {
    await reply(
      'Send /start with the code from your Liteneen dashboard to link this chat, ' +
      'or /stop to unlink it.',
    );
    return jsonResponse({ ok: true });
  }

  const supabase = getSupabaseAdmin();
  const code = startMatch[1];

  if (text.startsWith('/stop')) {
    await supabase
      .from('notification_channels')
      .delete()
      .eq('kind', 'telegram')
      .eq('address', String(chatId));
    await reply('Unlinked. This chat will no longer receive Liteneen alerts.');
    return jsonResponse({ ok: true });
  }

  if (!code) {
    await reply(
      'To link this chat, open your Liteneen dashboard → Notifications, ' +
      'add a Telegram channel, and send the code it gives you as `/start <code>`.',
    );
    return jsonResponse({ ok: true });
  }

  // The pending channel row carries the code; claiming it binds this chat.
  const { data: pending } = await supabase
    .from('notification_channels')
    .select('channel_id, owner_id')
    .eq('kind', 'telegram')
    .eq('verify_token', code)
    .is('verified_at', null)
    .maybeSingle();

  if (!pending) {
    await reply('That code is not valid or has already been used. Generate a new one in the dashboard.');
    return jsonResponse({ ok: true });
  }

  const { error } = await supabase
    .from('notification_channels')
    .update({
      address: String(chatId),
      verified_at: new Date().toISOString(),
      verify_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq('channel_id', pending.channel_id);

  if (error) {
    console.error('[OACP] Telegram link failed:', error);
    await reply('Something went wrong linking this chat. Try generating a new code.');
    return jsonResponse({ ok: true });
  }

  console.log(`[OACP] Telegram chat ${chatId} linked to owner ${pending.owner_id}`);
  await reply(
    '✅ Linked. This chat will now get Liteneen alerts when one of your agents needs a decision — ' +
    'like an unknown agent trying to reach it. Send /stop to unlink.',
  );
  return jsonResponse({ ok: true });
}

/** POST /notifications/verify — confirm a channel with its emailed token. */
async function handleNotificationVerify(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!body.verify_token) return errorResponse('verify_token is required', 400);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('notification_channels')
    .update({ verified_at: new Date().toISOString(), verify_token: null, updated_at: new Date().toISOString() })
    .eq('verify_token', body.verify_token as string)
    .select('channel_id, kind, address');
  if (error) return errorResponse('Verification failed', 500);
  if (!data || data.length === 0) {
    return errorResponse('That confirmation link is no longer valid', 404);
  }
  return jsonResponse({ verified: true, channel: data[0] });
}

// ============================================================
// Token Economy
// ============================================================

/**
 * GET /balance — Get an agent's token balance
 * Public — anyone can see balances.
 */
async function handleGetBalance(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');

  if (!agentId) {
    return errorResponse('agent_id query parameter is required', 400);
  }

  const idErrors = validateUUID(agentId, 'agent_id');
  if (idErrors.length > 0) return validationErrorResponse(idErrors);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('balances')
    .select('agent_id, balance, updated_at')
    .eq('agent_id', agentId)
    .single();

  if (error || !data) {
    return errorResponse('Agent balance not found', 404);
  }

  return jsonResponse(data);
}

/**
 * GET /transactions — Get transaction history for an agent
 * Auth required — only the agent can see their own transactions.
 */
async function handleGetTransactions(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const txType = url.searchParams.get('type');

  if (!agentId) {
    return errorResponse('agent_id query parameter is required', 400);
  }

  const idErrors = validateUUID(agentId, 'agent_id');
  if (idErrors.length > 0) return validationErrorResponse(idErrors);

  // Auth check
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent, error: authError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', agentId)
    .single();

  if (authError || !agent || agent.registry_token !== tokenHash) {
    return errorResponse('Unauthorized', 403);
  }

  // Query transactions where agent is sender or recipient
  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .or(`from_agent_id.eq.${agentId},to_agent_id.eq.${agentId}`);

  if (txType) {
    query = query.eq('type', txType);
  }

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data: txns, error: txError, count } = await query;

  if (txError) {
    console.error('[OACP] Transaction query error:', txError);
    return errorResponse('Failed to retrieve transactions', 500);
  }

  return jsonResponse({ transactions: txns || [], total: count || 0, limit });
}

/**
 * POST /transfer — Transfer tokens between agents
 * Auth required — sender must authenticate.
 */
async function handleTransfer(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const requiredErrors = validateRequired(body, ['from_agent_id', 'to_agent_id', 'amount']);
  if (requiredErrors.length > 0) return validationErrorResponse(requiredErrors);

  const fromErrors = validateUUID(body.from_agent_id, 'from_agent_id');
  const toErrors = validateUUID(body.to_agent_id, 'to_agent_id');
  if (fromErrors.length > 0) return validationErrorResponse(fromErrors);
  if (toErrors.length > 0) return validationErrorResponse(toErrors);

  const amount = body.amount as number;
  if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
    return errorResponse('amount must be a positive integer', 400);
  }

  // Auth check
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: sender, error: authError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', body.from_agent_id)
    .single();

  if (authError || !sender || sender.registry_token !== tokenHash) {
    return errorResponse('Unauthorized', 403);
  }

  // Execute atomic transfer
  const { data: txId, error: transferError } = await supabase
    .rpc('oacp_transfer', {
      p_from_agent_id: body.from_agent_id,
      p_to_agent_id: body.to_agent_id,
      p_amount: amount,
      p_type: (body.type as string) || 'task_payment',
      p_message_id: (body.message_id as string) || null,
      p_description: (body.description as string) || '',
    });

  if (transferError) {
    const msg = transferError.message || 'Transfer failed';
    if (msg.includes('Insufficient balance')) {
      return errorResponse('Insufficient balance', 402, {
        required: amount,
        detail: msg,
      });
    }
    console.error('[OACP] Transfer error:', transferError);
    return errorResponse(msg, 500);
  }

  console.log(
    `[OACP] Transfer: ${amount} tokens ${(body.from_agent_id as string).substring(0, 8)}... → ${(body.to_agent_id as string).substring(0, 8)}... (tx: ${txId})`,
  );

  return jsonResponse({ transaction_id: txId, amount, status: 'completed' }, 201);
}

/**
 * POST /collect-payment — Provider collects payment after completing a task
 * Server verifies the task_result message exists before debiting requester.
 */
async function handleCollectPayment(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const requiredErrors = validateRequired(body, ['provider_agent_id', 'requester_agent_id', 'amount', 'message_id']);
  if (requiredErrors.length > 0) return validationErrorResponse(requiredErrors);

  // Auth — provider must authenticate
  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: provider, error: authError } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', body.provider_agent_id)
    .single();

  if (authError || !provider || provider.registry_token !== tokenHash) {
    return errorResponse('Unauthorized', 403);
  }

  // Verify the original task_request message exists and was sent by the requester to this provider
  const { data: origMsg, error: msgError } = await supabase
    .from('messages')
    .select('message_id, sender_agent_id, recipient_agent_id, message_type')
    .eq('message_id', body.message_id)
    .single();

  if (msgError || !origMsg) {
    return errorResponse('Original task message not found', 404);
  }

  if (origMsg.sender_agent_id !== body.requester_agent_id || origMsg.recipient_agent_id !== body.provider_agent_id) {
    return errorResponse('Message does not match the requester/provider pair', 400);
  }

  const amount = body.amount as number;
  if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
    return errorResponse('amount must be a positive integer', 400);
  }

  // Execute atomic transfer: requester → provider
  const { data: txId, error: transferError } = await supabase
    .rpc('oacp_transfer', {
      p_from_agent_id: body.requester_agent_id,
      p_to_agent_id: body.provider_agent_id,
      p_amount: amount,
      p_type: 'task_payment',
      p_message_id: body.message_id,
      p_description: `Payment for ${body.action_name || 'task'} (msg: ${(body.message_id as string).substring(0, 8)}...)`,
    });

  if (transferError) {
    const msg = transferError.message || 'Transfer failed';
    if (msg.includes('Insufficient balance')) {
      return errorResponse('Requester has insufficient balance', 402, { required: amount, detail: msg });
    }
    console.error('[OACP] Payment collection error:', transferError);
    return errorResponse(msg, 500);
  }

  console.log(`[OACP] 💰 Payment: ${amount} tokens from ${(body.requester_agent_id as string).substring(0, 8)}... → ${(body.provider_agent_id as string).substring(0, 8)}...`);

  return jsonResponse({ transaction_id: txId, amount, status: 'collected' }, 201);
}

/**
 * Stub handler for unimplemented routes.
 */
// ============================================================
// Credit Work (proof-of-work earning)
// ============================================================

async function handleCreditWork(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const errors = validateRequired(body, ['agent_id', 'tokens_used']);
  if (errors.length > 0) return validationErrorResponse(errors);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Verify the agent is crediting itself
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_id, registry_token, name')
    .eq('agent_id', body.agent_id)
    .single();

  if (!agent || agent.registry_token !== tokenHash) {
    return errorResponse('Unauthorized — agents can only credit themselves', 403);
  }

  const tokensUsed = body.tokens_used as number;
  if (typeof tokensUsed !== 'number' || tokensUsed <= 0 || tokensUsed > 100000) {
    return errorResponse('tokens_used must be between 1 and 100,000', 400);
  }

  // Verify the message exists and this agent was the recipient (they did the work)
  if (body.message_id) {
    const { data: msg } = await supabase
      .from('messages')
      .select('recipient_agent_id')
      .eq('message_id', body.message_id)
      .single();

    if (msg && msg.recipient_agent_id !== body.agent_id) {
      return errorResponse('Agent was not the recipient of this task', 403);
    }
  }

  // Credit the agent
  const { data: txId, error: creditError } = await supabase.rpc('oacp_credit_work', {
    p_agent_id: body.agent_id,
    p_tokens_used: tokensUsed,
    p_message_id: (body.message_id as string) || null,
    p_description: `Proof-of-work: ${tokensUsed} LLM tokens used`,
  });

  if (creditError) {
    console.error('[OACP] Credit work error:', creditError);
    return errorResponse('Failed to credit work', 500);
  }

  // Update reputation
  await supabase.rpc('oacp_update_reputation', {
    p_agent_id: body.agent_id,
    p_completed: true,
    p_response_ms: (body.duration_ms as number) || null,
  });

  console.log(`[OACP] 💰 Credited ${tokensUsed} tokens to ${agent.name} (proof-of-work)`);

  return jsonResponse({ transaction_id: txId, tokens_credited: tokensUsed, status: 'credited' }, 201);
}

// ============================================================
// Teams
// ============================================================

async function handleCreateTeam(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const nameErrors = validateRequired(body, ['name']);
  if (nameErrors.length > 0) return validationErrorResponse(nameErrors);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Find the agent creating the team
  const { data: owner, error: authErr } = await supabase
    .from('agents')
    .select('agent_id, registry_token, name')
    .eq('registry_token', tokenHash)
    .single();

  if (authErr || !owner) return errorResponse('Unauthorized', 403);

  // Create team
  const { data: team, error: createErr } = await supabase
    .from('teams')
    .insert({
      name: body.name as string,
      description: (body.description as string) || '',
      owner_agent_id: owner.agent_id,
    })
    .select('team_id, name, created_at')
    .single();

  if (createErr) {
    console.error('[OACP] Team create error:', createErr);
    return errorResponse('Failed to create team', 500);
  }

  // Add owner as member with 'owner' role
  await supabase.from('team_members').insert({
    team_id: team.team_id,
    agent_id: owner.agent_id,
    role: 'owner',
  });

  console.log(`[OACP] Team created: ${team.name} by ${owner.name}`);
  return jsonResponse({ ...team, owner_agent_id: owner.agent_id }, 201);
}

async function handleAddTeamMember(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const errors = validateRequired(body, ['team_id', 'agent_id']);
  if (errors.length > 0) return validationErrorResponse(errors);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Verify requester is team owner or admin
  const { data: requester } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('registry_token', tokenHash)
    .single();

  if (!requester) return errorResponse('Unauthorized', 403);

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', body.team_id)
    .eq('agent_id', requester.agent_id)
    .single();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return errorResponse('Only team owners and admins can add members', 403);
  }

  // Add the member
  const { error: addErr } = await supabase.from('team_members').insert({
    team_id: body.team_id as string,
    agent_id: body.agent_id as string,
    role: (body.role as string) || 'member',
  });

  if (addErr) {
    if (addErr.message?.includes('duplicate')) return errorResponse('Agent is already a team member', 409);
    return errorResponse('Failed to add member', 500);
  }

  return jsonResponse({ team_id: body.team_id, agent_id: body.agent_id, status: 'added' }, 201);
}

async function handleGetTeams(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');
  const teamId = url.searchParams.get('team_id');

  const supabase = getSupabaseAdmin();

  if (teamId) {
    // Get specific team with members
    const { data: team, error } = await supabase
      .from('teams')
      .select('*')
      .eq('team_id', teamId)
      .single();

    if (error || !team) return errorResponse('Team not found', 404);

    const { data: members } = await supabase
      .from('team_members')
      .select('agent_id, role, joined_at')
      .eq('team_id', teamId);

    // Enrich with agent names
    const enriched = [];
    for (const m of members || []) {
      const { data: a } = await supabase.from('agents').select('name, status').eq('agent_id', m.agent_id).single();
      enriched.push({ ...m, name: a?.name, status: a?.status });
    }

    return jsonResponse({ ...team, members: enriched });
  }

  if (agentId) {
    // Get teams for an agent
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('agent_id', agentId);

    const teams = [];
    for (const m of memberships || []) {
      const { data: t } = await supabase.from('teams').select('*').eq('team_id', m.team_id).single();
      if (t) teams.push({ ...t, my_role: m.role });
    }

    return jsonResponse({ teams });
  }

  // List all teams
  const { data: allTeams, error } = await supabase
    .from('teams')
    .select('*')
    .order('created_at', { ascending: false });

  return jsonResponse({ teams: allTeams || [] });
}

// ============================================================
// Reputation
// ============================================================

async function handleGetReputation(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');

  const supabase = getSupabaseAdmin();

  if (agentId) {
    const { data, error } = await supabase
      .from('reputation')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error || !data) {
      return jsonResponse({ agent_id: agentId, score: 0.5, tasks_completed: 0, tasks_failed: 0, message: 'No reputation data yet' });
    }
    return jsonResponse(data);
  }

  // Leaderboard — top agents by score
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
  const { data, error } = await supabase
    .from('reputation')
    .select('*')
    .order('score', { ascending: false })
    .limit(limit);

  return jsonResponse({ leaderboard: data || [] });
}

// ============================================================
// Webhooks
// ============================================================

async function handleRegisterWebhook(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const errors = validateRequired(body, ['callback_url']);
  if (errors.length > 0) return validationErrorResponse(errors);

  // SSRF hardening: a callback_url the registry will later POST to must be
  // a public https endpoint. Reject non-https and any host that resolves to
  // loopback/link-local/private space by name. (Delivery is not yet wired;
  // this closes the vector before it ships.)
  const urlError = validateCallbackUrl(body.callback_url as string);
  if (urlError) return errorResponse(urlError, 400, { error_code: 'invalid_callback_url' });

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('registry_token', tokenHash)
    .single();

  if (!agent) return errorResponse('Unauthorized', 403);

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .insert({
      agent_id: agent.agent_id,
      callback_url: body.callback_url as string,
      events: (body.events as string[]) || ['task_request', 'task_result', 'task_error'],
      secret: (body.secret as string) || null,
    })
    .select('id, callback_url, events, created_at')
    .single();

  if (error) return errorResponse('Failed to register webhook', 500);

  return jsonResponse(webhook, 201);
}

// ============================================================
// Escrow
// ============================================================

async function handleEscrowHold(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const errors = validateRequired(body, ['requester_id', 'provider_id', 'amount']);
  if (errors.length > 0) return validationErrorResponse(errors);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  // Verify requester auth
  const { data: requester } = await supabase
    .from('agents')
    .select('agent_id, registry_token')
    .eq('agent_id', body.requester_id)
    .single();

  if (!requester || requester.registry_token !== tokenHash) return errorResponse('Unauthorized', 403);

  const { data: escrowId, error } = await supabase.rpc('oacp_escrow_hold', {
    p_requester_id: body.requester_id,
    p_provider_id: body.provider_id,
    p_amount: body.amount as number,
    p_message_id: (body.message_id as string) || null,
  });

  if (error) {
    if (error.message?.includes('Insufficient')) return errorResponse('Insufficient balance', 402);
    return errorResponse(error.message || 'Escrow failed', 500);
  }

  return jsonResponse({ escrow_id: escrowId, status: 'held', amount: body.amount }, 201);
}

/**
 * Authenticate the caller by registry token and confirm they are a
 * participant (requester or provider) of the escrow. Prevents a third
 * party from releasing/refunding escrows they have nothing to do with.
 */
async function authEscrowParticipant(
  req: Request,
  escrowId: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<{ escrow: any } | { error: Response }> {
  if (!escrowId || typeof escrowId !== 'string') {
    return { error: errorResponse('escrow_id is required', 400) };
  }
  const token = extractBearerToken(req);
  if (!token) return { error: errorResponse('Authorization required', 401) };

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_id')
    .eq('registry_token', tokenHash)
    .single();
  if (!agent) return { error: errorResponse('Unauthorized', 403) };

  const { data: escrow } = await supabase
    .from('escrow')
    .select('id, requester_id, provider_id, status')
    .eq('id', escrowId)
    .single();
  if (!escrow) return { error: errorResponse('Escrow not found', 404) };

  if (agent.agent_id !== escrow.requester_id && agent.agent_id !== escrow.provider_id) {
    return { error: errorResponse('Only the requester or provider of this escrow may resolve it', 403, { error_code: 'not_escrow_participant' }) };
  }
  return { escrow };
}

async function handleEscrowRelease(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const auth = await authEscrowParticipant(req, body.escrow_id);
  if ('error' in auth) return auth.error;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc('oacp_escrow_release', { p_escrow_id: body.escrow_id });

  if (error) return errorResponse(error.message || 'Release failed', 500);

  return jsonResponse({ escrow_id: body.escrow_id, status: 'released' });
}

async function handleEscrowRefund(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const auth = await authEscrowParticipant(req, body.escrow_id);
  if ('error' in auth) return auth.error;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc('oacp_escrow_refund', { p_escrow_id: body.escrow_id });

  if (error) return errorResponse(error.message || 'Refund failed', 500);

  return jsonResponse({ escrow_id: body.escrow_id, status: 'refunded' });
}

function notImplemented(route: string): Response {
  return errorResponse(`${route} is not yet implemented`, 501);
}

// ============================================================
// Router
// ============================================================

// ============================================================
// Thread Control — pause / resume / end a conversation
// ============================================================

/**
 * POST /threads/set-status
 * Body: { agent_id, correlation_id, status: 'active' | 'paused' | 'ended' }
 * Auth: Bearer registry token. Only a participant of the thread
 * (sender or recipient of at least one message on it) may change status.
 * An 'ended' thread is final — it cannot be reactivated.
 */
async function handleThreadSetStatus(req: Request): Promise<Response> {
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { agent_id: agentId, correlation_id: correlationId, status } = body;
  if (!agentId || !correlationId || !status) {
    return errorResponse('agent_id, correlation_id, and status are required', 400);
  }
  if (!['active', 'paused', 'ended'].includes(status)) {
    return errorResponse("status must be 'active', 'paused', or 'ended'", 400);
  }

  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('agent_id, registry_token, name')
    .eq('agent_id', agentId)
    .single();

  if (agentError || !agent) return errorResponse('Agent not found', 404);
  if (agent.registry_token !== tokenHash) return errorResponse('Invalid registry token', 403);

  // Participant check: the agent must appear on at least one message of the thread
  const { data: participation } = await supabase
    .from('messages')
    .select('message_id')
    .eq('correlation_id', correlationId)
    .or(`sender_agent_id.eq.${agentId},recipient_agent_id.eq.${agentId}`)
    .limit(1);

  if (!participation || participation.length === 0) {
    return errorResponse('Thread not found, or agent is not a participant of this thread', 403, {
      error_code: 'not_a_participant',
    });
  }

  // Ended threads are final
  const { data: existing } = await supabase
    .from('thread_states')
    .select('status')
    .eq('correlation_id', correlationId)
    .maybeSingle();

  if (existing?.status === 'ended') {
    return errorResponse('Thread has been ended and cannot be reactivated', 403, {
      error_code: 'thread_ended',
    });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from('thread_states')
    .upsert({
      correlation_id: correlationId,
      status,
      set_by_agent_id: agentId,
      updated_at: now,
    });

  if (upsertError) {
    console.error('[OACP] Thread state upsert error:', upsertError);
    return errorResponse('Failed to update thread status', 500);
  }

  console.log(`[OACP] Thread ${correlationId.substring(0, 8)}… set to ${status} by ${agent.name}`);
  return jsonResponse({ correlation_id: correlationId, status, set_by_agent_id: agentId, updated_at: now });
}

/**
 * POST /threads/update — RFC 001: change a thread's visibility tier and/or
 * public summary.
 * Body: { agent_id, correlation_id, visibility?, public_summary? }
 * Auth: Bearer registry token; participants only.
 * Visibility is a ratchet: open → summarized → private → secret. Downgrades
 * are rejected (v1) because they would retroactively expose history the
 * counterparty sent under a stronger promise.
 */
async function handleThreadUpdate(req: Request): Promise<Response> {
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { agent_id: agentId, correlation_id: correlationId, visibility, public_summary: publicSummary } = body;
  if (!agentId || !correlationId) {
    return errorResponse('agent_id and correlation_id are required', 400);
  }
  if (visibility === undefined && publicSummary === undefined) {
    return errorResponse('Provide visibility and/or public_summary', 400);
  }

  const TIER_ORDER = ['open', 'summarized', 'private', 'secret'];
  if (visibility !== undefined && !TIER_ORDER.includes(visibility)) {
    return errorResponse(`visibility must be one of: ${TIER_ORDER.join(', ')}`, 400);
  }
  if (publicSummary !== undefined && publicSummary !== null &&
      (typeof publicSummary !== 'string' || publicSummary.length > 200)) {
    return errorResponse('public_summary must be a string of at most 200 characters (or null to clear)', 400);
  }

  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('agent_id, registry_token, name')
    .eq('agent_id', agentId)
    .single();

  if (agentError || !agent) return errorResponse('Agent not found', 404);
  if (agent.registry_token !== tokenHash) return errorResponse('Invalid registry token', 403);

  // Participant check: the agent must appear on at least one message of the thread
  const { data: participation } = await supabase
    .from('messages')
    .select('message_id')
    .eq('correlation_id', correlationId)
    .or(`sender_agent_id.eq.${agentId},recipient_agent_id.eq.${agentId}`)
    .limit(1);

  if (!participation || participation.length === 0) {
    return errorResponse('Thread not found, or agent is not a participant of this thread', 403, {
      error_code: 'not_a_participant',
    });
  }

  const { data: existing } = await supabase
    .from('thread_states')
    .select('status, visibility, public_summary')
    .eq('correlation_id', correlationId)
    .maybeSingle();

  const currentVisibility = existing?.visibility ?? 'open';
  const newVisibility = visibility ?? currentVisibility;

  if (TIER_ORDER.indexOf(newVisibility) < TIER_ORDER.indexOf(currentVisibility)) {
    return errorResponse(
      `Visibility can only move toward more private (${currentVisibility} → ${newVisibility} is a downgrade). Downgrades would retroactively expose history sent under a stronger promise.`,
      403,
      { error_code: 'visibility_downgrade', current: currentVisibility, requested: newVisibility },
    );
  }

  // public_summary only exists on observer-visible tiers; upgrades clear it
  const newSummary = (newVisibility === 'open' || newVisibility === 'summarized')
    ? (publicSummary !== undefined ? publicSummary : (existing?.public_summary ?? null))
    : null;

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from('thread_states')
    .upsert({
      correlation_id: correlationId,
      status: existing?.status ?? 'active',
      visibility: newVisibility,
      public_summary: newSummary,
      set_by_agent_id: agentId,
      updated_at: now,
    });

  if (upsertError) {
    console.error('[OACP] Thread update error:', upsertError);
    return errorResponse('Failed to update thread', 500);
  }

  console.log(`[OACP] Thread ${String(correlationId).substring(0, 8)}… visibility=${newVisibility} by ${agent.name}`);
  return jsonResponse({
    correlation_id: correlationId,
    status: existing?.status ?? 'active',
    visibility: newVisibility,
    public_summary: newSummary,
    updated_at: now,
  });
}

/**
 * GET /threads?correlation_id=<id>
 * Public: returns the thread's status ('active' if never set), visibility
 * tier, and public summary. Secret threads are indistinguishable from
 * unknown threads here.
 */
async function handleGetThreadStatus(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const correlationId = url.searchParams.get('correlation_id');
  if (!correlationId) return errorResponse('correlation_id query parameter is required', 400);

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('thread_states')
    .select('status, visibility, public_summary, set_by_agent_id, updated_at')
    .eq('correlation_id', correlationId)
    .maybeSingle();

  // Secret threads do not exist to observers: report defaults
  if (data?.visibility === 'secret') {
    return jsonResponse({
      correlation_id: correlationId,
      status: 'active',
      visibility: null,
      public_summary: null,
      set_by_agent_id: null,
      updated_at: null,
    });
  }

  return jsonResponse({
    correlation_id: correlationId,
    status: data?.status || 'active',
    visibility: data?.visibility || 'open',
    public_summary: data?.public_summary || null,
    set_by_agent_id: data?.set_by_agent_id || null,
    updated_at: data?.updated_at || null,
  });
}

const routes: Record<string, Record<string, RouteHandler>> = {
  '/threads/set-status': {
    POST: (req) => handleThreadSetStatus(req),
  },
  '/threads/update': {
    POST: (req) => handleThreadUpdate(req),
  },
  '/threads': {
    GET: (req) => handleGetThreadStatus(req),
  },
  '/health': {
    GET: () => handleHealth(),
  },
  '/': {
    GET: () => handleHealth(),
  },
  '/register': {
    POST: (req) => handleRegister(req),
  },
  '/heartbeat': {
    POST: (req) => handleHeartbeat(req),
  },
  '/owners/attach': {
    POST: (req) => handleOwnersAttach(req),
  },
  '/handles/claim': {
    POST: (req) => handleHandlesClaim(req),
  },
  '/resolve': {
    GET: (req) => handleResolve(req),
  },
  '/friends/code': {
    POST: (req) => handleFriendCode(req),
  },
  '/friends/redeem': {
    POST: (req) => handleFriendRedeem(req),
  },
  '/friends': {
    GET: (req) => handleFriendsList(req),
  },
  '/friends/policy': {
    POST: (req) => handleFriendPolicy(req),
  },
  '/agents/set-access': {
    POST: (req) => handleSetAccess(req),
  },
  '/discover': {
    GET: (req) => handleDiscover(req),
  },
  '/messages/send': {
    POST: (req) => handleMessageSend(req),
  },
  '/messages': {
    GET: (req) => handleGetMessages(req),
  },
  '/messages/flag': {
    POST: (req) => handleMessageFlag(req),
  },
  '/contacts/set': {
    POST: (req) => handleContactsSet(req),
  },
  '/contacts': {
    GET: (req) => handleContactsList(req),
  },
  '/approvals/pending': {
    GET: (req) => handleApprovalDescribe(req),
  },
  '/approvals/decide': {
    POST: (req) => handleApprovalDecide(req),
  },
  '/notifications/channels': {
    GET: (req) => handleNotificationChannels(req),
    POST: (req) => handleNotificationChannels(req),
  },
  '/notifications/verify': {
    POST: (req) => handleNotificationVerify(req),
  },
  '/notifications/telegram': {
    POST: (req) => handleTelegramWebhook(req),
  },
  '/balance': {
    GET: (req) => handleGetBalance(req),
  },
  '/transactions': {
    GET: (req) => handleGetTransactions(req),
  },
  '/transfer': {
    POST: (req) => handleTransfer(req),
  },
  '/collect-payment': {
    POST: (req) => handleCollectPayment(req),
  },
  '/credit-work': {
    POST: (req) => handleCreditWork(req),
  },
  '/teams/create': {
    POST: (req) => handleCreateTeam(req),
  },
  '/teams/add-member': {
    POST: (req) => handleAddTeamMember(req),
  },
  '/teams': {
    GET: (req) => handleGetTeams(req),
  },
  '/reputation': {
    GET: (req) => handleGetReputation(req),
  },
  '/webhooks/register': {
    POST: (req) => handleRegisterWebhook(req),
  },
  '/escrow/hold': {
    POST: (req) => handleEscrowHold(req),
  },
  '/escrow/release': {
    POST: (req) => handleEscrowRelease(req),
  },
  '/escrow/refund': {
    POST: (req) => handleEscrowRefund(req),
  },
};

// ============================================================
// Main Handler
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleCors();
  }

  const route = extractRoute(req.url);
  const method = req.method.toUpperCase();

  const routeHandlers = routes[route];
  if (!routeHandlers) {
    return errorResponse(`Route not found: ${route}`, 404);
  }

  const handler = routeHandlers[method];
  if (!handler) {
    return errorResponse(`Method ${method} not allowed for ${route}`, 405);
  }

  try {
    // Rate limit check
    const rateLimitId = getRateLimitId(req);
    const rateLimited = await checkRateLimit(rateLimitId, route);
    if (rateLimited) return rateLimited;

    return await handler(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error(`[OACP] Error handling ${method} ${route}:`, err);
    return errorResponse(message, 500);
  }
});
