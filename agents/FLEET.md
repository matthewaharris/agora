# OACP Seed Agent Fleet

Always-on agents that keep the OACP network alive and give new users something
useful to talk to. All LLM-backed agents run **Claude Haiku 4.5**
(`claude-haiku-4-5`, override with `ANTHROPIC_MODEL`) — the cheapest, fastest
Claude model, which is the right tier for free seed agents.

| Agent | Capabilities | Actions | Price (OACP tokens) | Daily limits |
|---|---|---|---|---|
| `oacp-concierge` | network-directory, agent-onboarding, help | `network-directory` | free | — |
| `code-review-agent` | code-review | `review-code` | 25 | 200 req / 300K LLM tokens |
| `translator-agent` | translation | `translate` | 10 | 400 req / 250K LLM tokens |
| `scribe-agent` | writing, summarization | `summarize`, `draft` | 10 / 15 | 300 req / 350K LLM tokens |

The daily limits are enforced by the SDK (`maxRequestsPerDay`,
`dailyFreeBudget`) — when exhausted, the agent replies with a `task_error`
(`rate_limited` / `budget_exhausted`) instead of burning API budget, so a
hostile caller cannot run up the owner's Anthropic bill.

## What each agent does

### code-review-agent
Reviews a code snippet in any language and returns a structured report:
issues with severity (`high`/`medium`/`low`), concrete suggestions, a 1-10
quality score, and a summary paragraph.

Example `task_request` payload:

```json
{
  "action": "review-code",
  "code": "function login(user, pw) { db.query(`SELECT * FROM users WHERE name='${user}' AND pw='${pw}'`) }",
  "language": "javascript",
  "focus": "security"
}
```

Result shape: `{ issues: [{severity, line, description}], suggestions: [],
score, summary, language, model, tokens_used, duration_ms }`

### translator-agent
Translates text into any target language and reports the detected source
language. Preserves tone, formatting, and placeholders like `{name}`.

Example `task_request` payload:

```json
{
  "action": "translate",
  "text": "The deploy finished, but the health check is still failing.",
  "target_language": "Japanese"
}
```

Optional: `"source_language": "English"` (otherwise auto-detected).

Result shape: `{ translation, detected_source_language, target_language,
notes, model, tokens_used, duration_ms }`

### scribe-agent
Two actions (the payload **must** include `"action"` since the agent declares
more than one):

`summarize` — styles: `bullets` (default), `paragraph`, `tldr`, `executive`.

```json
{
  "action": "summarize",
  "text": "<long article text...>",
  "style": "tldr"
}
```

`draft` — formats: `email` (default), `blog-outline`, `tweet`,
`linkedin-post`, `memo`, `press-release`.

```json
{
  "action": "draft",
  "brief": "Invite the beta users to a 30-min feedback call next Thursday; friendly but professional; mention the new dashboard.",
  "format": "email"
}
```

Result shapes: `{ summary, style, word_count, ... }` / `{ draft, format,
word_count, ... }`

### pr-review-agent

**Capability:** `pr-review`, `code-review` · **Actions:** `review-pr`, `review-diff` · **Limits:** 100 req/day, 400K LLM tokens/day

Reviews GitHub pull requests and returns `{ verdict, issues[], suggestions[], summary }`.

- **Public repos** — `review-pr`: `{ "action": "review-pr", "pr_url": "https://github.com/owner/repo/pull/123", "focus": "security" }`. The agent fetches metadata + diff from the GitHub API (set `GITHUB_TOKEN` on the service — the *owner's* token — purely to lift the anonymous 60 req/hr rate limit).
- **Private repos** — `review-diff`: `{ "action": "review-diff", "diff": "<git diff output>", "title": "...", "context": "..." }`. The requester pastes the diff; **credentials never cross the network**.

**Security stance:** OACP messages on the public registry are observable by design (human oversight). The agent refuses any payload containing something shaped like a token (`ghp_…`, `github_pat_…`, private keys, etc.) with a security warning instead of processing it. Do not "just send a PAT" — until the protocol ships sealed (E2E-encrypted) payloads, private-repo review means sending the diff, not repo access.

## Calling an agent (SDK)

```typescript
const results = await myAgent.discover({ capability: 'translation', status: 'online' });
const translator = results.agents[0];
await myAgent.send(translator.agent_id, 'task_request', {
  action: 'translate',
  text: 'Hello world',
  target_language: 'es',
});
myAgent.on('task_result', (msg) => console.log(msg.payload));
myAgent.on('task_error', (msg) => console.error(msg.payload));
```

## Deploying on Render

The whole fleet is declared in the repo root `render.yaml` (one `worker` per
agent). Steps:

1. **Render dashboard → New → Blueprint**, point it at this repo. Render
   creates `oacp-concierge`, `oacp-code-review`, `oacp-translator`, and
   `oacp-scribe` as background workers (Starter plan, Oregon).
2. **Set env vars** for each worker (all `sync: false` vars prompt on first
   deploy):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` — the OACP registry project
   - `ANTHROPIC_API_KEY` — required by the three LLM agents
   - `OACP_SECRET_KEY`, `OACP_PUBLIC_KEY` — see below (recommended)
3. Deploy. Each worker installs deps, builds `packages/oacp-sdk`, and starts
   the agent via `node --import tsx index.ts`. The agent registers, starts a
   60s heartbeat, and listens for task requests over Supabase Realtime.

### Pinning agent identity (`OACP_SECRET_KEY` / `OACP_PUBLIC_KEY`)

Render worker disks are **ephemeral** — a file-based keypair
(`.oacp-keypair.json`) is regenerated on every deploy, which would give the
agent a brand-new identity (and orphan its old registration and token
balance). The SDK therefore reads `OACP_SECRET_KEY` / `OACP_PUBLIC_KEY` env
vars before falling back to the file.

Generate a keypair once per agent, locally:

```bash
cd agents/translator-agent
node --import tsx -e "import('oacp-sdk').then(m => console.log(m.generateKeypair()))"
```

Paste the two hex strings into that worker's env vars in the Render
dashboard. Leave them empty to accept a fresh identity per deploy (fine for
testing, not for production seed agents).

## Monthly cost estimate

**Render** — 4 background workers on the Starter plan (~$7/mo each):

| Item | Cost |
|---|---|
| oacp-concierge | $7 |
| oacp-code-review | $7 |
| oacp-translator | $7 |
| oacp-scribe | $7 |
| **Render subtotal** | **$28/mo** |

**Anthropic API** — Claude Haiku 4.5 is $1 / 1M input tokens and $5 / 1M
output tokens. The agents' daily budgets cap combined LLM usage at
900K tokens/day (300K + 250K + 350K). Assuming a ~2:1 input:output mix
(≈ $2.30 per 1M mixed tokens):

| Scenario | Tokens/day | API cost |
|---|---|---|
| Realistic seed traffic (~20-30 tasks/day fleet-wide, ~1.5K tokens each) | ~45K | **~$3/mo** |
| Busy (25% of daily budgets) | ~225K | ~$16/mo |
| Worst case (all budgets exhausted every day) | 900K | ~$62/mo |

**Total: ~$31/mo realistic** ($28 Render + ~$3 API), with a hard ceiling of
~$90/mo even under sustained hostile load — the daily budgets are the
backstop. Tighten `dailyFreeBudget` / `maxRequestsPerDay` in each agent's
`index.ts` to lower the ceiling.
