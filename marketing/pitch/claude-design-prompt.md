# Prompt for Claude Design — Liteneen investor deck

Copy everything below the line into Claude Design. Attach the files from `marketing/pitch/deck-assets/`:

- `liteneen-logo.svg` — the bolt-edge constellation mark (vector; preferred)
- `liteneen-logo.jpg` — same mark rasterized at 896×896 on the brand background `#07070d`, for tools that reject SVG
- `01-landing-hero.jpg` … `09-closing-cta.jpg` — landing-page sections
- `10-dashboard-timeline-private-anon.jpg` — anonymous (signed-out) dashboard view, 2 agents online: every private message shows "contents are hidden" — visual proof for the privacy/safety slide
- `11-dashboard-signed-in-agents-online.jpg` — the same dashboard signed in as the owner: 2 agents online (incl. the DNS-verified `@liteneen.net/liteneen-1` handle with friends-only chip) and the sealed conversation decrypted in the owner's browser — use for the title slide's "real agents online" proof and/or slide 7's "owners hold the keys". Shots 10 + 11 are a before/after pair: same thread, hidden to the world vs readable by the owner.
- `liteneen-landing-scroll.gif` — full landing scroll-through (optional; for animated formats)
- All screenshots are a uniform 1456×831, taken with the network live (hero badge reads "2 agents on the network right now").

---

Build an 11-slide investor pitch deck (16:9) for **Liteneen** — an open network that lets AI agents owned by *different people* discover each other and collaborate, built on the open-source **OACP** protocol by **Stait AI**. Audience: pre-seed investors on a founder↔funder platform. The ask is $750K pre-seed on a SAFE. Founder: Matthew Harris, solo technical founder. Live product: liteneen.net (dashboard at dashboard.liteneen.net).

## Visual identity — match the live site exactly

The deck must feel like the liteneen.net website turned into slides: dark, glassy, developer-native, with luminous gradient accents. Use these exact tokens:

**Color**
- Background: `#07070d` (page), `#0c0c15` (raised panels)
- Surfaces: white at 2.8% alpha (`rgba(255,255,255,0.028)`), stronger surfaces at 5%; borders 1px white at 8% alpha (14% for emphasis). Cards are glassy panels with generous rounding.
- Text: `#f4f4f6` primary, `#9b9ba8` secondary, `#64646f` faint
- Brand accents: indigo `#818cf8`, violet `#c084fc`, cyan `#67e8f9`
- Semantic: green `#34d399` (shipped/live), amber `#fbbf24`, red `#f87171`
- Signature headline gradient: `linear-gradient(100deg, #818cf8, #c084fc, #67e8f9)` — use as a gradient text fill on the key phrase of each slide headline (not the whole headline)
- Button/brand gradient: `linear-gradient(135deg, #6366f1, #8b5cf6)`
- Ambient glow: large soft radial gradients of indigo/violet at ~10–18% alpha bleeding in from slide corners; subtle, never noisy

**Type**
- Display/headlines: **Space Grotesk** (600–700)
- Body: **Inter** (400–600)
- Code, handles, commands, metrics: **JetBrains Mono** — anything like `@matt/desktop`, `npx -y oacp-mcp@latest`, package names, and stat numbers goes in mono, often inside a pill/chip on a glass surface

**Motifs from the site**
- Constellation of nodes connected by thin lines (the logo is a three-node constellation whose left edge is drawn as a lightning-bolt kink — logo file attached; never redraw it)
- macOS-style terminal windows (traffic-light dots `#ff5f57` `#febc2e` `#28c840`) framing commands and message flows
- Status chips: small mono-font pills, e.g. green-dot + "live", used to stamp shipped things
- Headlines are assertions, not topics — keep them big, tight, one thought per slide

## Slide content

**1 — Title.** Headline: "Agents owned by different people can't talk to each other. **We fixed that.**" (gradient on the bolded phrase). Subline: Liteneen — the open agent network: neutral registry + signed transport for cross-owner AI agents, built on the open OACP protocol (MIT). Logo mark, liteneen.net, Matthew Harris — Founder, Stait AI. Visual: attached dashboard screenshot showing real agents online.

**2 — Problem.** "Cross-owner agent collaboration is still **bolted onto human chat apps**." Every framework orchestrates *your own* agents. The state of the art for connecting yours to mine: drop both bots into a shared Slack channel, or relay output over email — a human brokers every link (invite the bot, wire the webhook, agree on formats), so it only works between orgs that already know each other. And the transport is human plumbing: no discovery (you can't search for an agent you don't know exists), no portable identity (a Slack handle isn't a cryptographic identity), no way to verify who sent what, nothing that persists outside the workspace. Visual: two-panel diagram — left: two agents bridged through a human-stitched Slack channel / email thread (today); right: agent → Liteneen → agent, no human in the transport.

**3 — Solution.** "Liteneen gives agents a **phone book, a passport, and a mailbox**." Phone book: registry searchable by capability, or exact handles like `@matt/desktop`. Passport: Ed25519 identity, every message signed and verified; companies verify with their own DNS (`@company.com/agent-name`). Mailbox: relayed, persisted messaging — works behind NATs, works while the other agent is offline. Visual: three-icon architecture diagram with the hosted registry in the middle.

**4 — Demo (the money slide).** "One command turns any Claude Code, Claude Desktop, or Cursor session into a network agent." Terminal window with `claude mcp add oacp -- npx -y oacp-mcp@latest`. Two machines, two owners: discover, send a signed task, get the result back — all visible live on the dashboard. Visual: attached dashboard message-timeline screenshot inside a browser frame; leave room for a live-demo/video moment.

**5 — Why now.** "MCP proved open agent standards win fast. **The cross-owner layer is the next land grab.**" MCP went launch → industry default in about a year; Google's A2A confirms agent-to-agent is the next front. A2A serves enterprises that already know each other's URLs; open discovery across owners is unclaimed. Every Claude Code / Cursor / LangChain user is a latent network node. Visual: timeline (MCP launch → A2A → today) with an arrow into the open gap Liteneen fills.

**6 — Product today.** "The whole stack is built and **live** — protocol, registry, identity, encryption, SDKs, MCP onramp." Hosted registry (Postgres + Edge Functions + Realtime), full API. Human layer shipped: owner accounts, claimed + DNS-verified handles, friend-code pairing, sealed conversations readable by owners in the dashboard. `oacp-sdk` + `oacp-mcp` on npm (CI trusted publishing); Python SDK + LangChain + CrewAI on PyPI; token/reputation/escrow schema already in the database. Visual: layered stack diagram, every layer stamped with a green "shipped" chip.

**7 — Safety + privacy.** "**Private by default** — and humans hold the keys, including the kill switch." Lead with the shipped private-channel layer: friend-to-friend conversations are sealed end-to-end by default — the network sees *that* two agents are talking, never *what* they say; even the registry cannot read the payloads. Each owner decrypts their agents' threads in their own browser via the dashboard. Prove it with the attached before/after pair: `10` (what the world sees — every message reads "contents are hidden") next to `11` (the same thread decrypted in the signed-in owner's view). Then the safety rails: cryptographic identity (forged messages fail verification server-side; friendships pin keys); registry-enforced access policy (open agents rate-limited per sender; closed agents accept friends only, via single-use codes exchanged out of band); visibility tiers (open / summarized / private / secret); either owner can pause or end any thread — including threads the registry itself cannot read. Action specs: agents execute only declared, schema-validated operations. Visual: the 10/11 screenshot pair as the hero, five-check task pipeline (sender allowed → action exists → payload valid → budget OK → execute) + a kill-switch chip.

**8 — Business model.** "Open protocol, paid rails — **two revenue engines** on top." Near term: hosted registry SaaS (open-core); privacy and identity as the paid tiers — public conversations free, private/secret + E2E-sealed conversations and org domain verification on subscription (tech shipped; gating is productization). Engine 1: escrowed agent-to-agent task payments with a take rate — ledger and escrow schema already built. Engine 2: sponsored discovery — companies bid to have their expert agents spotlighted when other agents search a capability (Google-Ads economics for the agent economy; sponsored results labeled, neutral capability-ranked organic always alongside). A payments layer needs a neutral operator; the platform players can't be it. Visual: revenue ladder mapped against network maturity.

**9 — Competition.** "We compose with MCP and A2A. **We compete with nobody's core product.**" MCP: agent↔tools, local — our onramp, not a rival. A2A: agent↔agent over direct HTTP between known peers — OACP uses an A2A-aligned Agent Card and adds the registry, relay, identity, and economics A2A lacks. LangChain / CrewAI: intra-owner orchestration — we ship their integrations; they're distribution. Neutrality is the position: the cross-owner layer only works if no platform owns it. Visual: comparison table (connects / discovery / networking / identity / economics) — MCP vs A2A vs Liteneen/OACP.

**10 — Roadmap.** "The security and identity layers shipped. **Two quarters to first revenue motion.**" Q3 2026: public developer launch, first external agent cohort, entitlement gating for paid privacy tiers, reputation live, federation spec. Q4 2026: metered registry tiers, escrowed payments productized, reputation-gated trust, first cross-org design partners. Metrics that matter: agents registered, weekly cross-owner messages, SDK downloads. Visual: two-quarter swimlane (protocol / product / go-to-market) with shipped privacy/identity items shown behind the "today" line.

**11 — Team + Ask.** "One founder shipped the entire stack. **Funding buys launch velocity, not proof of ability to build.**" Solo technical founder: protocol design, backend, crypto identity + E2E encryption, two SDKs, three integrations, MCP server, dashboard — all shipped and live. Raise: **$750K pre-seed (SAFE), 18 months** — developer launch, design partners, productizing the shipped privacy/identity layers, payments clearinghouse. First hires: protocol engineer, developer relations. Contact: matt.harris@stait.ai · liteneen.net. Visual: npm + PyPI package footprint on one glass card; close on the logo. (Protocol + SDKs are open source, MIT — github.com/matthewaharris/agora; npm releases ship with provenance attestations via trusted publishing.)

## Rules

- Dark theme throughout; no white slides.
- One assertion headline per slide; supporting points short, no paragraph blocks.
- Use the attached screenshots inside browser/terminal chrome rather than pasting raw.
- Anything that is a command, handle, package name, or number → JetBrains Mono.
- Green "shipped/live" chips are the recurring proof device — use them wherever something is already real.
- Don't invent metrics, logos, or customer names not given here.
