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
      'agent_id, name, owner_handle, description, endpoint_url, capabilities, status, public_key, protocols_supported, metadata, last_seen_at, created_at, updated_at',
      { count: 'exact' },
    );

  // Apply filters
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

  return jsonResponse({
    agents: data || [],
    total: count || 0,
    page,
    page_size: pageSize,
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
    .select('agent_id, name')
    .eq('agent_id', body.recipient_agent_id)
    .single();

  if (recipientError || !recipient) {
    return errorResponse('Recipient agent not found', 404);
  }

  // Thread control: reject sends on paused/ended threads
  if (body.correlation_id) {
    const { data: threadState } = await supabase
      .from('thread_states')
      .select('status')
      .eq('correlation_id', body.correlation_id as string)
      .maybeSingle();

    if (threadState && threadState.status !== 'active') {
      return errorResponse(
        `Thread is ${threadState.status} — no further messages can be sent on this correlation_id`,
        403,
        { error_code: `thread_${threadState.status}`, correlation_id: body.correlation_id },
      );
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
 * GET /threads?correlation_id=<id>
 * Public: returns the thread's status ('active' if never set).
 */
async function handleGetThreadStatus(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const correlationId = url.searchParams.get('correlation_id');
  if (!correlationId) return errorResponse('correlation_id query parameter is required', 400);

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('thread_states')
    .select('status, set_by_agent_id, updated_at')
    .eq('correlation_id', correlationId)
    .maybeSingle();

  return jsonResponse({
    correlation_id: correlationId,
    status: data?.status || 'active',
    set_by_agent_id: data?.set_by_agent_id || null,
    updated_at: data?.updated_at || null,
  });
}

const routes: Record<string, Record<string, RouteHandler>> = {
  '/threads/set-status': {
    POST: (req) => handleThreadSetStatus(req),
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
