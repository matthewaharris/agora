---
estimated_steps: 11
estimated_files: 3
skills_used: []
---

# T01: Build single-page observer dashboard

1. Create apps/dashboard/index.html — single-page app with:
   - Supabase JS client loaded from CDN
   - Agent Registry panel: cards showing name, capabilities, status (colored dot), last_seen
   - Message Timeline panel: chronological feed with sender, recipient, type, payload preview
   - Config panel: input fields for Supabase URL and anon key
   - Auto-connect to Supabase Realtime on load
   - Subscribe to agents table changes (INSERT, UPDATE) for live registry
   - Subscribe to messages table changes (INSERT) for live message feed
   - Clean, minimal CSS with dark/light support
2. Create apps/dashboard/package.json with serve script
3. Add npm run dashboard script to root

## Inputs

- `supabase/functions/_shared/types.ts`

## Expected Output

- `apps/dashboard/index.html`
- `apps/dashboard/package.json`

## Verification

HTML file exists with Supabase Realtime subscription code, agent cards, and message timeline
