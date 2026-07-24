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
import {
  canonicalizeMessage,
  verifyMessageSignature,
} from '../_shared/crypto.ts';
import {
  validateRequired,
  validateCapabilities,
  validatePublicKey,
  validateUUID,
  type ValidationError,
} from '../_shared/validation.ts';
import type {
  RegisterRequest,
  HeartbeatRequest,
  AgentStatus,
} from '../_shared/types.ts';

const OACP_VERSION = '0.1.0';
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
  '/resolve': { window: 60, max: 60 },
  '/discover': { window: 60, max: 60 },
  '/collect-payment': { window: 60, max: 30 },
  '/credit-work': { window: 60, max: 30 },
  '/transfer': { window: 60, max: 20 },
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
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
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
    .select('owner_id, handle')
    .eq('owner_id', agent.owner_id)
    .single();
  if (!owner) return errorResponse('Owner account not found', 404);

  let finalOwnerHandle = owner.handle as string | null;

  if (ownerHandle !== undefined) {
    const h = String(ownerHandle).toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(h) || h.length < 3) {
      return errorResponse('owner_handle must be 3-32 chars: lowercase letters, digits, inner hyphens', 400);
    }
    if (RESERVED_HANDLES.has(h)) {
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
      const { error: claimError } = await supabase
        .from('owners')
        .update({ handle: h, updated_at: new Date().toISOString() })
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
  if (parts.length > 2 || !HANDLE_RE.test(parts[0]) || (parts[1] !== undefined && !HANDLE_RE.test(parts[1]))) {
    return errorResponse('handle must look like @owner or @owner/agent', 400);
  }
  const [ownerPart, agentPart] = parts;

  const supabase = getSupabaseAdmin();
  const { data: owner } = await supabase
    .from('owners')
    .select('owner_id, handle, owner_public_key')
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

  return jsonResponse(
    agentPart
      ? { handle: raw, agent: cards[0] }
      : { handle: `@${owner.handle}`, owner_public_key: owner.owner_public_key, agents: cards },
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

async function areFriends(agentA: string, agentB: string): Promise<boolean> {
  const { lo, hi } = friendPair(agentA, agentB);
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('friendships')
    .select('agent_lo')
    .eq('agent_lo', lo)
    .eq('agent_hi', hi)
    .maybeSingle();
  return !!data;
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
    .select('agent_lo, agent_hi, pinned_key_lo, pinned_key_hi, created_at')
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
      friends_since: e.created_at,
    });
  }

  return jsonResponse({ friends, total: friends.length });
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
  const validTypes = ['task_request', 'task_ack', 'task_result', 'task_error', 'chat'];
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
    .select('agent_id, name, access_policy')
    .eq('agent_id', body.recipient_agent_id)
    .single();

  if (recipientError || !recipient) {
    return errorResponse('Recipient agent not found', 404);
  }

  // RFC 002 §3.5: access policy — closed agents accept friends only (with a
  // reply carve-out for threads the closed agent started); open agents rate
  // limit non-friends per sender-recipient pair.
  const senderIsFriend = await areFriends(senderAgentId, recipient.agent_id);
  if (!senderIsFriend) {
    if (recipient.access_policy === 'closed') {
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
      if (!replyAllowed) {
        return errorResponse(
          `${recipient.name} only accepts messages from friends. Ask their human for a friend code, then redeem it (oacp_add_friend).`,
          403,
          { error_code: 'not_friends', access_policy: 'closed' },
        );
      }
    } else {
      const { data: pairAllowed } = await supabase.rpc('oacp_check_rate_limit', {
        p_identifier: `pair:${senderAgentId}:${recipient.agent_id}`,
        p_endpoint: '/messages/send-pair',
        p_window_seconds: 3600,
        p_max_requests: 20,
      });
      if (pairAllowed === false) {
        return errorResponse(
          'Rate limit exceeded for messages to this recipient (20/hour for non-friends). Establish a friendship (friend code) for unlimited messaging.',
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
  const isSealed = (body.payload as Record<string, unknown> | undefined)?.sealed === true;

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
      // Thread creation. A sealed first message with no explicit tier defaults
      // to 'private' — you cannot claim public visibility while hiding contents.
      threadVisibility = requestedVisibility ?? (isSealed ? 'private' : 'open');
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

  return jsonResponse(
    {
      message_id: message.message_id,
      sender_agent_id: senderAgentId,
      recipient_agent_id: body.recipient_agent_id,
      message_type: body.message_type,
      created_at: message.created_at,
      visibility: threadVisibility ?? 'open',
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

  return jsonResponse({
    messages: messages || [],
    total: count || 0,
    limit,
  });
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

async function handleEscrowRelease(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  if (!body.escrow_id) return errorResponse('escrow_id is required', 400);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc('oacp_escrow_release', { p_escrow_id: body.escrow_id });

  if (error) return errorResponse(error.message || 'Release failed', 500);

  return jsonResponse({ escrow_id: body.escrow_id, status: 'released' });
}

async function handleEscrowRefund(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  if (!body.escrow_id) return errorResponse('escrow_id is required', 400);

  const token = extractBearerToken(req);
  if (!token) return errorResponse('Authorization required', 401);

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
