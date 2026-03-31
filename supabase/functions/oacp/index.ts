/**
 * OACP Edge Function — Main Router
 *
 * Single "fat function" handling all OACP API routes:
 *   GET  /oacp/health         — Health check
 *   POST /oacp/register       — Agent registration
 *   POST /oacp/heartbeat      — Agent heartbeat
 *   GET  /oacp/discover       — Agent discovery
 *   POST /oacp/messages/send  — Send message (stub — M002)
 *
 * Uses path-based routing to minimize cold starts.
 */

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
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
    POST: () => notImplemented('/messages/send'),
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
