# S02: Web Observer Dashboard

**Goal:** Build a lightweight web observer dashboard that shows live agent registry state and message timeline via Supabase Realtime
**Demo:** After this: Open dashboard in browser; see agents appear live; watch messages flow

## Tasks
- [x] **T01: Built zero-build-step observer dashboard with live agent registry and message timeline via Supabase Realtime** — 1. Create apps/dashboard/index.html — single-page app with:
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
  - Estimate: 30min
  - Files: apps/dashboard/index.html, apps/dashboard/package.json, package.json
  - Verify: HTML file exists with Supabase Realtime subscription code, agent cards, and message timeline
- [ ] **T02: Verify and document dashboard** — 1. Verify dashboard HTML is well-formed
2. Update README with dashboard section
3. Commit all S02 work
  - Estimate: 10min
  - Files: README.md
  - Verify: README has dashboard section; git commit succeeds
