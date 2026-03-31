# OACP — Open Agent Communication Protocol

> A decentralized registry and communication layer for AI agent interoperability.

OACP lets AI agents running in **different environments** — owned by different people — discover each other, verify identity, and collaborate on shared tasks. No shared platform required.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) >= 2.x
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Supabase stack)

### Setup

```bash
# Clone and install
git clone <repo-url> && cd oacp
npm install

# Start local Supabase (Postgres, Auth, Realtime, Edge Functions)
npm run supabase:start

# Serve Edge Functions locally
npm run supabase:functions
```

### Test the health endpoint

```bash
curl http://localhost:54321/functions/v1/oacp/health
# → { "status": "ok", "version": "0.1.0", "protocol": "oacp", "timestamp": "..." }
```

## Project Structure

```
oacp/
├── supabase/
│   ├── config.toml              # Supabase project configuration
│   ├── migrations/              # Postgres migrations
│   │   └── 20250331000001_create_agents_table.sql
│   └── functions/
│       ├── _shared/             # Shared types and utilities
│       │   ├── types.ts         # Agent Card, Message Envelope types
│       │   └── cors.ts          # CORS headers and response helpers
│       └── oacp/
│           └── index.ts         # Main API router (fat function)
├── packages/
│   └── oacp-sdk/                # TypeScript SDK for agents
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── agents/                      # Reference agent implementations
│   └── README.md
├── apps/                        # Web dashboard (future)
├── package.json                 # Monorepo root (npm workspaces)
├── .gsd/                        # GSD project management
└── PRD/                         # Product Requirements Document
```

## API Endpoints

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| `GET` | `/oacp/health` | ✅ Implemented | Health check |
| `POST` | `/oacp/register` | 🚧 M001/S02 | Register an agent |
| `POST` | `/oacp/heartbeat` | 🚧 M001/S02 | Send heartbeat |
| `GET` | `/oacp/discover` | 🚧 M001/S02 | Discover agents |
| `POST` | `/oacp/messages/send` | 🚧 M002 | Send message |

## Tech Stack

- **Backend:** [Supabase](https://supabase.com) (Postgres + Edge Functions + Realtime)
- **SDK:** TypeScript / Node.js
- **Crypto:** [Ed25519](https://www.npmjs.com/package/@noble/ed25519) via `@noble/ed25519`
- **Dashboard:** React / Next.js on Vercel (planned)
- **Agent Runtime:** Node.js on Render (planned)

## Deployment

| Component | Platform | Status |
|-----------|----------|--------|
| API + DB + Realtime | Supabase | Planned |
| Web Dashboard | Vercel | Planned |
| Reference Agents | Render | Planned |

## License

MIT
