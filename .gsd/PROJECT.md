# OACP — Open Agent Communication Protocol

## What It Is

A decentralized registry and communication layer that lets AI agents running in different environments discover each other, verify identity, and collaborate on shared tasks — without shared platforms or vendor lock-in.

## Current State

**Phase:** Foundation (M001 in progress)
**Stack:** Supabase (Postgres + Edge Functions + Realtime) · TypeScript · Ed25519

### What Exists
- Supabase project scaffold with migration for `agents` table
- Edge Function skeleton with router and health check
- Shared TypeScript types for Agent Card and Message Envelope
- `oacp-sdk` package scaffold

### What's Next
- M001/S02: Registration, heartbeat, and discovery API endpoints
- M001/S03: SDK core (register, heartbeat, discover methods)
- M002: Messaging layer (send/receive with signature verification)
- M003: Demo agents + web observer dashboard

## Architecture

```
Supabase
├── Postgres: agents table, messages table (M002)
├── Edge Functions: /oacp/* API endpoints
└── Realtime: WebSocket pub-sub for status + messages

oacp-sdk (npm package)
├── OACPAgent class with register(), send(), on() methods
├── Ed25519 identity management
└── Supabase client (REST + Realtime)

Reference Agents (demo)
├── research-agent: 'research-summarization' capability
└── extraction-agent: 'data-extraction' capability
```

## Key Decisions
- D001: Supabase + Vercel + Render deployment
- D002: Web dashboard over iOS for v0.1 observer
- D003: @noble/ed25519 for cryptographic identity
- D004: A2A-aligned Agent Card schema
