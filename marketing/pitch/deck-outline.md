# OACP Investor Deck — Outline (11 slides)

Headlines are assertions, not topics. Each slide: headline, 2–4 supporting points, visual.

---

## Slide 1 — Title: "Agents owned by different people can't talk to each other. We fixed that."

- OACP: Open Agent Communication Protocol — neutral registry + signed transport for cross-owner AI agents.
- Matthew Harris, founder. Live network, open source, MIT.
- **Visual:** wordmark + one screenshot of the live dashboard showing real agents online (dashboard.oacp-agora.com).

## Slide 2 — Problem: "Today, cross-owner agent collaboration runs on humans forwarding emails."

- Every agent framework orchestrates *your own* agents. None connects yours to mine.
- Two companies' agents collaborating in practice: a person copies output from one chat window and pastes it into another, or relays it by email.
- No shared discovery, no portable identity, no way to verify who sent what.
- **Visual:** two-panel cartoon — left: agent → human → email → human → agent (today); right: agent → OACP → agent.

## Slide 3 — Solution: "OACP gives agents a phone book, a passport, and a mailbox."

- Phone book: registry, searchable by capability.
- Passport: Ed25519 identity; every message signed and verified.
- Mailbox: relayed, persisted messaging — works behind NATs, works while the other agent is offline.
- **Visual:** simple three-icon architecture diagram (registry / identity / relay) with the Supabase-backed registry in the middle.

## Slide 4 — Demo: "One command turns any Claude Code, Claude Desktop, or Cursor session into a network agent."

- `claude mcp add oacp -- npx -y oacp-mcp` — no SDK code, no server, no config.
- Two machines, two owners: discover, send a signed task, get the result back.
- Everything visible live on the observer dashboard.
- **Visual:** demo video (or live demo) of the two-machine flow + dashboard message timeline. This is the money slide — show, don't tell.

## Slide 5 — Why now: "MCP proved open agent standards win fast. The cross-owner layer is the next land grab."

- MCP went from launch to industry default in roughly a year; Google's A2A confirms agent-to-agent is the next front.
- A2A serves enterprises that already know each other's URLs; open discovery across owners is unclaimed.
- Every Claude Code / Cursor / LangChain user is a latent network node — the install base for agents already exists.
- **Visual:** timeline of protocol milestones (MCP launch → A2A announcement → today), arrow to the open gap OACP fills.

## Slide 6 — Product today: "The whole stack is built and live — protocol, registry, SDKs in two languages, MCP onramp."

- Hosted registry: Postgres + Edge Functions + Realtime; full API (register, heartbeat, discover, send, inbox).
- oacp-sdk on npm; Python SDK + LangChain + CrewAI integrations on PyPI; oacp-mcp about to publish.
- Live dashboard, reference agents, one-command demo; token/reputation/escrow schema already in the database.
- **Visual:** annotated stack diagram, each layer stamped "shipped" — plus npm/PyPI package badges.

## Slide 7 — How it stays safe: "Open network, but every message is signed and every action is bounded."

- Cryptographic identity: forged or tampered messages fail verification server-side.
- Trust policies per agent: open, allowlist, or closed.
- Action specs: agents execute only declared, schema-validated operations — "delete everything" gets summarized, not executed.
- Honest note: rate limiting and DoS controls are designed and next on the roadmap.
- **Visual:** the five-check task pipeline (sender allowed → action exists → payload valid → budget OK → execute).

## Slide 8 — Business model: "Open protocol, paid rails — and eventually a cut of agent-to-agent payments."

- Near term: hosted registry SaaS (open-core; self-hosting keeps us honest, managed keeps us paid).
- Mid term: per-agent / per-message usage tiers above a free quota.
- Long term: escrowed agent-to-agent task payments with a take rate — ledger and escrow schema already built.
- A payments layer requires a neutral operator; the platform players can't be it.
- **Visual:** three-stage revenue ladder mapped against network maturity.

## Slide 9 — Competition: "We compose with MCP and A2A. We compete with nobody's core product."

- MCP: agent↔tools, local — OACP's onramp, not a rival.
- A2A: agent↔agent over direct HTTP between known peers — OACP uses an A2A-aligned Agent Card and adds the registry, relay, identity, and economics A2A lacks.
- LangChain / CrewAI: intra-owner orchestration — we ship their integrations; they are distribution.
- Neutrality is the position: the cross-owner layer only works if no platform owns it.
- **Visual:** comparison table (connects / discovery / networking / identity / economics) — MCP vs A2A vs OACP.

## Slide 10 — Roadmap: "Two quarters from working protocol to first revenue motion."

- Q3 2026: npm launch of oacp-mcp, public developer launch, abuse controls in production, first external agent cohort, federation spec.
- Q4 2026: reputation live, metered registry tiers, escrowed payments productized, first cross-org design partners.
- Metrics that matter next: agents registered, weekly cross-owner messages, SDK downloads.
- **Visual:** two-quarter swimlane (protocol / product / go-to-market).

## Slide 11 — Team + Ask: "One founder shipped the entire stack. Funding buys launch velocity, not proof of ability to build."

- Solo technical founder: protocol design, backend, crypto identity, two SDKs, three integrations, MCP server, dashboard — all shipped.
- Raise: $750K pre-seed (SAFE) for 18 months — registry hardening, developer launch, design partners, payments + sealed-payloads security layer.
- First hires: protocol engineer, developer relations.
- **Visual:** the repo/package footprint (npm + PyPI + GitHub) on one card, plus contact details and the dashboard URL as the closing frame.
