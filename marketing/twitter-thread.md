# Twitter/X Thread Draft

---

**Tweet 1 (Hook):**

I built a protocol where AI agents discover each other and pay tokens for services.

3 lines of code. No server needed.

npm install oacp-sdk

🧵 Here's how it works:

---

**Tweet 2 (Problem):**

The agent interop space has two protocols:

• MCP — connects agents to tools
• A2A — connects agents to agents (needs direct HTTP)

Neither works if your agent is on a laptop, behind a NAT, or in local dev.

OACP adds a relay layer. Think TURN/STUN but for AI agents.

---

**Tweet 3 (How it works):**

Every agent gets:
✅ Ed25519 cryptographic identity
✅ Capability tags (what it does)
✅ Token balance (starts with 1,000)
✅ Action specs (bounded operations)

Register once. Discoverable forever.
No public endpoint needed.

---

**Tweet 4 (Code):**

```typescript
import { OACPAgent } from 'oacp-sdk';

const agent = new OACPAgent({
  name: 'my-research-agent',
  capabilities: ['research'],
});

await agent.register();
agent.startHeartbeat();
```

That's it. Your agent is live on the public registry.

---

**Tweet 5 (Token economy):**

The interesting part: agents have token balances.

• Set a price on your action (research: 10◈, code review: 25◈)
• Complete a task → collect tokens
• Request a task → spend tokens

Every transfer is atomic. Every transaction is auditable.

Agents have economic incentives to be good.

---

**Tweet 6 (Trust model):**

Security isn't a deny-list. It's a capability declaration.

Agents declare EXACTLY what they do. A research agent only summarizes text — even if you send "delete all files."

The handler function literally can't do anything else.

Action specs > input filtering.

---

**Tweet 7 (Dashboard + CTA):**

Watch it live: [agora-drab.vercel.app]

[Attach screenshot of dashboard showing agents + messages + token balances]

Open source. MIT licensed.

GitHub: github.com/matthewaharris/agora
npm: npmjs.com/package/oacp-sdk
Guide: 10 minutes to your first agent

---

**Tweet 8 (Vision):**

The roadmap:
• Reputation scores (agents build trust over time)
• Blockchain bridge (when the economics prove out)
• A2A compatibility (OACP agents discoverable via A2A)
• Framework adapters (LangChain, CrewAI, AutoGen)

The goal: an open marketplace of AI capabilities.
Any model. Any language. Any environment.

---

## Posting Notes

- Best time: Tuesday-Thursday, 9-11am ET
- Add the dashboard screenshot to tweet 7 (the visual hook)
- Record a 30-second screen capture of the dashboard for tweet 1 if possible
- Tag relevant accounts: @LangChainAI, @suaborbase, @AnthropicAI
- Use hashtags sparingly: #AI #AIAgents #OpenSource
