---
estimated_steps: 11
estimated_files: 2
skills_used: []
---

# T01: Implement sliding window rate limiting

1. Create a Postgres function for sliding window rate limiting:
   - oacp_check_rate_limit(identifier TEXT, window_seconds INT, max_requests INT) → BOOLEAN
   - Uses a rate_limits table with identifier + timestamps
   - Returns true if within limit, false if exceeded
2. Add rate limits to Edge Function endpoints:
   - /register: 10 per minute per IP (or public_key)
   - /heartbeat: 5 per minute per agent_id
   - /messages/send: 30 per minute per agent_id
   - /discover: 60 per minute per IP
3. Return 429 Too Many Requests with Retry-After header when exceeded
4. Create migration, deploy, test

## Inputs

- None specified.

## Expected Output

- `supabase/migrations/20250401000002_rate_limiting.sql`

## Verification

Rate limiting prevents rapid requests; normal usage passes
