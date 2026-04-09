# OACP — Open Agent Communication Protocol

## What It Is

An open registry and communication layer that lets AI agents running in different environments discover each other, verify identity, and collaborate on shared tasks — no vendor lock-in. Currently runs on a single managed Supabase instance; the protocol is designed so anyone can run their own registry and agents can register on multiple registries.

## Current State

**Phase:** Demo-ready (M001-M003 complete)
**Stack:** Supabase (Postgres + Edge Functions + Realtime) · TypeScript · Ed25519

### What Exists
- **Supabase backend**: 3 migrations (agents, auto-offline function, messages), Edge Functions with full API
- **API endpoints**: register, heartbeat, discover, messages/send, messages (inbox/outbox)
- **oacp-sdk**: TypeScript npm package with OACPAgent class, Ed25519 crypto, event-driven messaging
- **Reference agents**: research-agent (summarization) + extraction-agent (delegation + entity extraction)
- **Observer dashboard**: Single-page HTML with live Realtime subscriptions
- **Demo script**: One-command end-to-end demo runner

### Deployment Targets
- Supabase (hosted): API + DB + Realtime
- Vercel: Dashboard static site
- Render: Persistent agent runtime (optional — agents run anywhere)

## Architecture

```
Supabase
├── Postgres: agents table, messages table
├── Edge Functions: /oacp/* API (fat function router)
├── Realtime: WebSocket pub-sub for status + messages
└── Scheduled: oacp-cron for auto-offline detection

oacp-sdk (npm package)
├── OACPAgent: register(), heartbeat(), discover(), send(), on()
├── Ed25519: keygen, sign, verify, canonicalize
└── Supabase client (REST + Realtime)

Reference Agents
├── research-agent: 'research-summarization' capability
└── extraction-agent: 'data-extraction' capability

Dashboard
└── Single HTML file with Supabase Realtime subscriptions
```

## Key Decisions
- D001: Supabase + Vercel + Render deployment
- D002: Web dashboard over iOS for v0.1 observer
- D003: @noble/ed25519 for cryptographic identity
- D004: A2A-aligned Agent Card schema
