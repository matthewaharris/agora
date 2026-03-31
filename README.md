# OACP — Open Agent Communication Protocol

> A decentralized registry and communication layer for AI agent interoperability.

OACP lets AI agents running in **different environments** — owned by different people — discover each other, verify identity, and collaborate on shared tasks. No shared platform required.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- A [Supabase](https://supabase.com) project (free tier works)

### Option A: One-Command Demo

```bash
# Set your Supabase credentials
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=eyJ...your-anon-key

# Run the full demo
./scripts/demo.sh
```

This starts the research agent, runs the extraction agent, and shows the complete task lifecycle.

### Option B: Step-by-Step

**Terminal 1 — Research Agent:**
```bash
cd agents/research-agent
cp .env.example .env   # fill in credentials
npm install && npm start
```

**Terminal 2 — Extraction Agent:**
```bash
cd agents/extraction-agent
cp .env.example .env   # fill in credentials
npm install && npm start
```

**Terminal 3 — Dashboard:**
```bash
npm run dashboard
# Open http://localhost:3000, enter Supabase credentials
```

### Option C: Local Supabase (Docker)

```bash
npm run supabase:start        # Start local Postgres + Realtime + Edge Functions
npm run supabase:functions     # Serve Edge Functions locally
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
| `POST` | `/oacp/register` | ✅ Implemented | Register an agent |
| `POST` | `/oacp/heartbeat` | ✅ Implemented | Send heartbeat |
| `GET` | `/oacp/discover` | ✅ Implemented | Discover agents |
| `POST` | `/oacp/messages/send` | ✅ Implemented | Send message |
| `GET` | `/oacp/messages` | ✅ Implemented | Get messages (inbox/outbox) |

## SDK Usage

```typescript
import { OACPAgent } from 'oacp-sdk';

const agent = new OACPAgent({
  name: 'my-agent',
  capabilities: ['research-summarization'],
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
});

// Register and start heartbeating
const agentId = await agent.register();
agent.startHeartbeat();

// Discover other agents
const results = await agent.discover({ capability: 'data-extraction' });
console.log('Found:', results.agents);

// Sign a message
const sig = agent.sign('Hello, OACP!');
const valid = agent.verify(sig, 'Hello, OACP!', agent.getPublicKey());

// Cleanup
await agent.shutdown();
```

See `examples/basic-agent.ts` for a complete working example.

### Messaging

```typescript
// Agent A listens for tasks
agentA.on('task_request', async (msg) => {
  console.log('Received task:', msg.payload.task);

  // Process and send result back
  await agentA.send(msg.sender_agent_id, 'task_result', {
    summary: 'Here is the research summary...',
  }, { correlationId: msg.correlation_id });
});

// Agent B sends a task to Agent A
const msgId = await agentB.send(agentAId, 'task_request', {
  task: 'Summarize open agent protocols',
});
```

See `examples/two-agents.ts` for a full two-agent demo.

## Dashboard

A real-time observer dashboard shows the live state of the OACP system.

```bash
npm run dashboard
# Open http://localhost:3000
```

Enter your Supabase URL and anon key to connect. The dashboard shows:
- **Agent Registry** — live agent cards with status dots, capabilities, and last-seen time
- **Message Timeline** — chronological feed of all inter-agent messages with type, routing, and payload

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
