/**
 * OACP Edge Function — Main Router
 *
 * Single "fat function" handling all OACP API routes:
 *   GET  /oacp/health     — Health check
 *   POST /oacp/register   — Agent registration
 *   POST /oacp/heartbeat  — Agent heartbeat
 *   GET  /oacp/discover   — Agent discovery
 *   POST /oacp/messages/send — Send message
 *
 * Uses path-based routing to minimize cold starts.
 * See: https://supabase.com/docs/guides/functions/development-tips
 */

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const OACP_VERSION = '0.1.0';

/**
 * Extract the route path from the request URL.
 * Edge Functions are served at /functions/v1/<function-name>/<path>
 * We extract everything after the function name.
 */
function extractRoute(url: string): string {
  const u = new URL(url);
  const pathname = u.pathname;
  // Pattern: /functions/v1/oacp/<route>
  // Or in local dev: /oacp/<route>
  const match = pathname.match(/\/oacp(?:\/(.*))?$/);
  if (match) {
    return '/' + (match[1] || '');
  }
  // Fallback: use full pathname
  return pathname;
}

/**
 * Route handler type
 */
type RouteHandler = (req: Request) => Promise<Response> | Response;

/**
 * Health check endpoint
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
 * Stub handler for unimplemented routes.
 */
function notImplemented(route: string): Response {
  return errorResponse(`${route} is not yet implemented`, 501);
}

/**
 * Main router
 */
const routes: Record<string, Record<string, RouteHandler>> = {
  '/health': {
    GET: () => handleHealth(),
  },
  '/': {
    GET: () => handleHealth(),
  },
  '/register': {
    POST: () => notImplemented('/register'),
  },
  '/heartbeat': {
    POST: () => notImplemented('/heartbeat'),
  },
  '/discover': {
    GET: () => notImplemented('/discover'),
  },
  '/messages/send': {
    POST: () => notImplemented('/messages/send'),
  },
};

/**
 * Main request handler
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleCors();
  }

  const route = extractRoute(req.url);
  const method = req.method.toUpperCase();

  // Find matching route
  const routeHandlers = routes[route];
  if (!routeHandlers) {
    return errorResponse(`Route not found: ${route}`, 404);
  }

  const handler = routeHandlers[method];
  if (!handler) {
    return errorResponse(
      `Method ${method} not allowed for ${route}`,
      405,
    );
  }

  try {
    return await handler(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error(`[OACP] Error handling ${method} ${route}:`, err);
    return errorResponse(message, 500);
  }
});
