# OACP PRD Analysis & Research

## 1. Protocol Landscape Assessment (March 2026)

### Current State of Agent Protocols
- **MCP** — Anthropic's agent-to-tool protocol. Donated to Linux Foundation AAIF Dec 2025. 97M+ monthly npm downloads.
- **A2A** — Google's agent-to-agent protocol. v0.3 with 150+ backers. Uses Agent Cards, HTTP/SSE/JSON-RPC, gRPC.
- **ACP** — IBM BeeAI, merged into A2A ecosystem.
- **UCP** — Google's commerce-specific agent protocol.

### OACP's Unique Value
A2A requires direct HTTP connectivity between agents (client-server). OACP fills the gap for agents behind NATs, in local dev, or on mobile — using a **registry + realtime message relay** pattern (like TURN/STUN in WebRTC). Position as "A2A for the edge."

## 2. Technology Stack Validation

| Technology | Verdict | Notes |
|------------|---------|-------|
| Supabase Edge Functions | ✅ | Deno-based TS, global distribution, Realtime pub-sub built-in |
| Supabase Realtime | ✅ | WebSocket pub-sub on Postgres changes — perfect for message bus |
| Render | ✅ | Persistent Node.js for always-on agent processes |
| Vercel | ⚠️ Partial | Good for web dashboard/docs, NOT for agent runtime |
| @noble/ed25519 | ✅ | 5KB, zero deps, RFC8032, async/sync APIs, v3.0.x |

## 3. Key Recommendations

1. **Align Agent Card with A2A format** where possible (add version, structured capabilities)
2. **Single "fat" Edge Function** with path routing to reduce cold starts
3. **Merge heartbeats into agents table** (`last_seen_at` column) instead of separate table
4. **Add signature field** to message envelope schema
5. **Build web dashboard first**, defer iOS app to separate milestone
6. **SDK must work in both Node.js and Deno** (isomorphic)

## 4. Deployment Architecture

```
Supabase: Edge Functions (API) + Postgres (data) + Realtime (WebSocket pub-sub)
Vercel: Web dashboard / docs (if needed)
Render: Reference agent runtime (persistent Node.js)
Agents: Run anywhere with HTTP + WebSocket connectivity
```

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Realtime message ordering | Sequence numbers in envelope |
| Edge Function cold starts | Single fat function, scheduled warm pings |
| Supabase free tier (500 Realtime connections) | Fine for prototype |
| Deno vs Node.js compat | Isomorphic code, npm: specifiers |
