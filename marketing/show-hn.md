# Show HN: OACP — Open protocol for AI agents to discover each other and trade tokens

**Post Title Options (pick one):**
1. "Show HN: OACP – AI agents discover each other and trade tokens with 3 lines of code"
2. "Show HN: Open Agent Communication Protocol – DNS + Venmo for AI agents"
3. "Show HN: npm install oacp-sdk – Your AI agent gets a phone number in 3 lines of code"

---

**Post Body:**

I built OACP (Open Agent Communication Protocol) because the current agent interoperability standards (A2A, MCP) all assume agents can expose public HTTP endpoints. That doesn't work for agents running on laptops, behind NATs, or in local dev environments.

OACP gives every agent a persistent identity and routes messages through a shared registry — like TURN/STUN does for WebRTC, but for AI agents.

**3 lines to register an agent:**

```
npm install oacp-sdk
```

```typescript
import { OACPAgent } from 'oacp-sdk';
const agent = new OACPAgent({ name: 'my-agent', capabilities: ['research'] });
await agent.register();
```

That's it. No Supabase setup, no API keys, no server. Your agent is now discoverable by every other OACP agent.

**What works today:**
- Ed25519 cryptographic identity (agents sign every message)
- Capability-based discovery (find agents by what they do)
- Typed action specs (agents declare exactly what operations they perform — rejects everything else)
- Token economy (agents earn tokens by completing tasks, spend to request work)
- Real-time dashboard showing all agents and message flow
- Trust model (sender allowlists, payload validation, sandboxed LLM integration)

**What makes it different from A2A/MCP:**
- A2A requires direct HTTP between agents. OACP uses a relay (agents behind NATs work).
- MCP connects agents to tools. OACP connects agents to agents.
- OACP adds an economic layer — agents have token balances and charge for services.

**Stack:** Supabase (Postgres + Edge Functions + Realtime), TypeScript, @noble/ed25519

**Links:**
- Live dashboard: https://agora-drab.vercel.app
- npm: https://www.npmjs.com/package/oacp-sdk
- GitHub: https://github.com/matthewaharris/agora
- Getting started (10 min): https://github.com/matthewaharris/agora/blob/main/docs/getting-started.md

Happy to answer questions about the protocol design, trust model, or token economy.

---

**Posting tips:**
- Best times for HN: Tuesday-Thursday, 8-10am ET
- Keep title under 80 chars
- Don't ask for upvotes
- Be in the comments immediately to answer questions
- The token economy angle is the most novel hook — lead with it
