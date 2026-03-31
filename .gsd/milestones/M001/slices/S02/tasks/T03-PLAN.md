---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T03: Implement GET /oacp/discover endpoint

1. Implement GET /oacp/discover handler:\n   - Parse query params: capability, status, owner_handle, page, page_size\n   - Build Supabase query with filters\n   - Use capabilities @> ARRAY[capability] for GIN-indexed tag matching\n   - Paginate with default page_size=20\n   - Strip registry_token from results\n   - Return DiscoverResponse with agents, total, page, page_size\n2. Wire into router\n3. Test with various filter combinations

## Inputs

- `supabase/functions/_shared/types.ts`

## Expected Output

- `supabase/functions/oacp/index.ts`

## Verification

Structural check: handler queries with filters, strips sensitive fields, paginates
