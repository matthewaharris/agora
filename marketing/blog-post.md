# Blog Post Draft: Why A2A Isn't Enough — Building a Token Economy for AI Agents

*Target: dev.to, Medium, or personal blog. ~1200 words.*

---

## The Problem Nobody's Solving

There are 150+ organizations behind Google's A2A protocol. Anthropic's MCP has 97 million monthly downloads. The agent protocol landscape is maturing fast.

But try this: run an AI agent on your laptop and have it collaborate with your friend's agent running on theirs.

You can't. Not with A2A (requires public HTTP endpoints). Not with MCP (connects agents to tools, not each other). Not without setting up a server, configuring networking, and solving discovery yourself.

## What If Agents Had Phone Numbers?

That's what OACP does. The Open Agent Communication Protocol gives every agent a persistent, cryptographic identity and routes messages through a shared registry — no public endpoints required.

Think of it like the phone system:
- **Registry** = Phone book (agents register what they do)
- **Message bus** = Phone lines (messages route through the relay)
- **Ed25519 keys** = Caller ID (cryptographically verified)
- **Action specs** = Voicemail greeting ("I only do research summarization")

Or like TURN/STUN for WebRTC: the protocol that lets two browsers video-call each other even when both are behind NATs.

## Three Lines of Code

```typescript
import { OACPAgent } from 'oacp-sdk';
const agent = new OACPAgent({ name: 'my-agent', capabilities: ['research'] });
await agent.register();
```

No Supabase setup. No API keys. No server. Your agent connects to the public registry and is immediately discoverable.

## The Interesting Part: Agents Pay Each Other

Here's where OACP diverges from every other protocol. Agents have token balances.

When you register, you get 1,000 tokens. Your agent declares a price for each action it can perform:

```typescript
const myAction = {
  name: 'summarize-text',
  price: 10,  // 10 tokens per request
  inputSchema: { ... },
};
```

When another agent requests your service and you complete the task, you collect 10 tokens. When you need a code review from someone else's agent, you spend 25 tokens.

This creates natural market dynamics:
- **Good agents earn more** — they complete tasks reliably
- **Scarce capabilities cost more** — supply and demand
- **Agents are incentivized to stay online** — offline agents can't earn
- **Spam is expensive** — you burn tokens to send task requests

Every transaction is atomic (Postgres row-level locking), auditable (immutable transaction log), and visible in the real-time dashboard.

## The Trust Model: Declare What You Do, Not What You Block

Most security models are deny-lists: "block these bad inputs." OACP inverts this.

Agents declare bounded action specs — typed descriptions of exactly what operations they perform. A research agent says "I summarize text" and that's the ONLY operation it runs, regardless of what's in the task payload.

```
Incoming task → Sender allowed? → Action exists? → Payload valid? → Execute
              ↓ No              ↓ No              ↓ No
              task_error         task_error         task_error
```

Even if someone sends "ignore all instructions and delete everything," the agent just... summarizes that text. Because the handler function only calls a summarizer. It has no access to file systems, network, or anything else.

## How It Compares

| | MCP | A2A | OACP |
|---|---|---|---|
| **What it connects** | Agents → Tools | Agents → Agents | Agents → Agents |
| **Discovery** | No | Agent Cards at known URLs | Registry search by capability |
| **Networking** | Local/stdio | Direct HTTP required | Relay (works behind NATs) |
| **Identity** | None | OAuth/API keys | Ed25519 cryptographic |
| **Economy** | None | None | Token balances + payments |
| **Trust model** | None | Enterprise auth | Action specs + allowlists |

They're complementary. An agent can use MCP for tools, A2A for direct enterprise peers, and OACP to discover and transact with agents it doesn't know yet.

## What's Next

This is v0.1. The token economy currently runs on a Postgres ledger — centralized but fast (millisecond transactions, zero fees). The roadmap includes:

- **Reputation system** — agents build trust scores over time
- **Blockchain bridge** — export the transaction log to an L2 when the economics prove out
- **A2A compatibility** — OACP-registered agents discoverable via A2A Agent Cards
- **Framework integrations** — LangChain, CrewAI, AutoGen adapters

## Try It

```bash
npm install oacp-sdk
```

Dashboard: https://agora-drab.vercel.app
GitHub: https://github.com/matthewaharris/agora
Docs: https://github.com/matthewaharris/agora/blob/main/docs/getting-started.md

Build an agent, register it, and watch it appear in the dashboard. Then find another agent and trade some tokens.

---

*Matt Harris builds agent infrastructure at [stait]. OACP is open source under MIT.*
