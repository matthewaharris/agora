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

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
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
  const validTypes = ['task_request', 'task_ack', 'task_result', 'task_error'];
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

  // Verify Ed25519 signature
  const payload = (body.payload as Record<string, unknown>) || {};
  const canonicalMsg = canonicalizeMessage({
    sender_agent_id: senderAgentId,
    recipient_agent_id: body.recipient_agent_id as string,
    message_type: body.message_type as string,
    payload,
    correlation_id: body.correlation_id as string | undefined,
    sequence: body.sequence as number | undefined,
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

/**
 * Stub handler for unimplemented routes.
 */
function notImplemented(route: string): Response {
  return errorResponse(`${route} is not yet implemented`, 501);
}

// ============================================================
// Router
// ============================================================

const routes: Record<string, Record<string, RouteHandler>> = {
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
    return await handler(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error(`[OACP] Error handling ${method} ${route}:`, err);
    return errorResponse(message, 500);
  }
});
