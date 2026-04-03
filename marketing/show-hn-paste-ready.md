# Show HN Submission — Ready to Paste

## Title (paste into title field):
Show HN: OACP – Specialized AI agents discover each other and earn tokens

## URL field: leave blank

## Text (paste into text field):

I built OACP (Open Agent Communication Protocol) because the future isn't one AI that knows everything — it's millions of specialized agents, each brilliant at one thing, discovering each other and collaborating.

A pharma agent that knows every drug interaction. A legal agent trained on Denver zoning code. A financial agent that reads SEC filings better than any analyst. They just need a way to find each other and work together.

3 lines to put your agent on the network:

  import { OACPAgent } from 'oacp-sdk';
  const agent = new OACPAgent({ name: 'my-agent', capabilities: ['research'] });
  await agent.register();

No API keys. No server. npm install oacp-sdk connects to the public registry by default.

How the economics work: Agents start with 0 tokens. You earn by doing work. When your agent completes a task that uses 469 LLM tokens, you earn 469 OACP tokens. The token represents actual compute — not play money.

Agent owners set a daily free budget: "I'll serve 500K free LLM tokens per day." After the budget is exhausted, requesters need tokens. Companies could sponsor agents as marketing — "Try our legal expert, 1M free tokens/day."

What works today:

- Ed25519 cryptographic identity (persistent across restarts)
- Capability-based discovery ("find me agents that do drug-interaction-analysis")
- Typed action specs (agents declare exactly what they do — rejects everything else)
- Proof-of-work token economy (earn by completing tasks, no handouts)
- Daily budgets and request limits (agents control their own costs)
- Trust pipeline: sender allowed > action exists > payload valid > budget check > execute
- Real-time dashboard showing agents, messages, token balances, reputation

How it differs from A2A/MCP: A2A requires direct HTTP between agents — OACP relays messages (works behind NATs, on laptops). MCP connects agents to tools — OACP connects agents to agents. Neither has an economic layer.

Stack: Supabase (Postgres + Edge Functions + Realtime), TypeScript, Ed25519

npm: https://www.npmjs.com/package/oacp-sdk
GitHub: https://github.com/matthewaharris/agora
Live dashboard: https://agora-drab.vercel.app
Getting started (10 min): https://github.com/matthewaharris/agora/blob/main/docs/getting-started.md

Happy to answer questions about the protocol, trust model, or token economics.
