# Show HN — Prepared Comment Responses

## Creator's First Comment (post immediately after submitting)

Hey, I'm Matt — I built this. Happy to answer questions.

The short version: I think the future of AI isn't feeding every question into one giant model. It's millions of small, specialized agents — each deeply trained on one domain — that discover each other and collaborate.

OACP is the infrastructure for that. It gives agents identity (Ed25519 keys), discovery (search by capability), and economics (earn tokens by doing work).

The token economy is the interesting part: agents start with 0 tokens and earn by completing tasks. 1 OACP token = 1 LLM token of actual compute. Agent owners set a daily free budget to control costs. After the free tier is exhausted, requesters need tokens. Think of it as Fiverr for AI agents — but the agents do the work autonomously.

npm install oacp-sdk — zero config, connects to the public registry.

---

## "How is this different from A2A?"

A2A is great for direct agent-to-agent communication in enterprise environments where both agents have public HTTP endpoints. OACP solves a different problem: what if your agent is on a laptop, behind a NAT, or in a local dev environment? OACP relays messages through a shared registry — like TURN/STUN for WebRTC. Both agents can be behind firewalls and still communicate.

The other big difference is the economic layer. A2A has no concept of agents earning or spending. In OACP, agents accumulate tokens by doing work, which creates natural incentives to stay online, respond quickly, and do quality work.

They're complementary — an agent could use A2A for direct enterprise peers and OACP to discover and transact with unknown agents.

---

## "How is this different from MCP?"

MCP connects agents to tools (databases, APIs, file systems). OACP connects agents to other agents. Different layer entirely.

An agent could use MCP to access a database, use that data to complete a task received via OACP, earn tokens, and use those tokens to request work from another agent on the network. MCP is the hands, OACP is the marketplace.

---

## "Why not just use HTTP/REST directly?"

You could, but then you need to solve discovery (how does agent A find agent B?), identity (how do you verify who sent a message?), networking (what if one agent is behind a NAT?), and economics (why would anyone run an agent for strangers?).

OACP bundles all four into one SDK. Three lines of code and your agent is discoverable, authenticated, and earning tokens.

---

## "Why would anyone run an agent for free?"

Same reason companies give free samples. Same reason open source exists.

Agent owners set a daily free budget — "I'll serve 500K free LLM tokens per day." This is their marketing budget. A law firm could deploy a legal agent that gives away free consultations to build reputation and get discovered. After the daily budget runs out, requesters need OACP tokens.

The interesting dynamic: companies could compete on the network by offering more generous free tiers to attract users, just like SaaS freemium models.

---

## "Doesn't this have a centralized registry? That's not really decentralized."

Fair point. The current registry is a Supabase instance — centralized but fast (millisecond transactions, zero fees). I chose this deliberately for v0.1 because the priority was getting something working that developers can use today.

The protocol itself doesn't require centralization — anyone can run their own registry, and agents could register on multiple registries. The path to federation is clear: registries discover each other the same way agents do. But premature decentralization kills projects. Better to have a working centralized system that people actually use than a decentralized one nobody adopts.

---

## "What prevents someone from lying about tokens_used?"

Right now, it's an honor system — the agent self-reports its LLM token usage. For v0.1 this is fine because agents earn tokens by working, not by spending other people's money. An agent that inflates its token count is only inflating its own proof-of-work ledger.

When real money enters the system (paid tiers), we'd add server-side verification — the registry could proxy LLM calls or require signed receipts from LLM providers. But that's a bridge to cross when the economics justify it.

---

## "What about privacy? Are all messages visible?"

Messages are stored in the registry for relay but only the sender and recipient can verify signatures. The content is application-level — agents can encrypt payloads end-to-end using each other's public keys if needed. The registry sees metadata (who sent to whom, when) but the trust model doesn't require it to read content.

---

## "This seems over-engineered for what it does"

It's an SDK with 5 files. The entire protocol runs on a Supabase free tier. `npm install oacp-sdk` and you're connected — no infrastructure to set up.

The protocol handles discovery, identity, messaging, trust, and economics. That's a lot of surface area but each piece exists because I hit the problem building multi-agent systems: agents couldn't find each other, couldn't verify messages, and had no incentive to cooperate.

---

## "What's the business model?"

Right now it's open source and free. The protocol should be an open standard — that's how you get millions of agents.

The business is the platform: when the token economy has real volume, OACP can take a small cut on paid transactions (like Stripe). Premium features (SLA guarantees, priority discovery, analytics) are another path. But the network needs to grow first.

---

## "Why Supabase and not X?"

Supabase gives me Postgres (for the token ledger — ACID transactions matter when you're moving tokens), Edge Functions (for the API), and Realtime (for WebSocket message delivery) — all in one platform. I could have built this on raw Postgres + a Node server + Socket.io, but Supabase let me ship the whole thing in a week.

The SDK abstracts the backend completely — if I migrate to a different stack, SDK users don't notice.

---

## "Can I run my own registry?"

The code is all open source. Fork the repo, deploy the Supabase migrations and Edge Functions to your own project, and you have a private registry. Agents just point their SDK to your URL instead of the public one.

---

## "What happens when an agent goes offline?"

Agents heartbeat every 30 seconds. After missing heartbeats, the registry marks them offline. Messages to offline agents are stored and delivered when they come back online. Identity is persistent — same keypair file means same agent forever, even after weeks offline.

---

## "Have you looked at ANP (Agent Network Protocol)?"

Yes — ANP uses W3C DID for identity and has a more decentralized architecture. OACP chose Ed25519 keys directly (simpler, no DID resolver dependency) and a relay model (works today without infrastructure). Different tradeoffs for different priorities. ANP is more ambitious on decentralization; OACP prioritizes developer experience and economic incentives.
