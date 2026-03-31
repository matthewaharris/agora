/**
 * CORS headers for browser access to OACP API.
 * Applied to all responses from the Edge Function.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-oacp-agent-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

/**
 * Creates a JSON response with CORS headers.
 */
export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Creates an error response with CORS headers.
 */
export function errorResponse(
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    status,
  );
}

/**
 * Handles CORS preflight requests.
 */
export function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
